// @flow
import logger from '../logger'
import * as ChatTypes from '../constants/types/rpc-chat-gen'
import * as Types from '../constants/types/settings'
import * as Constants from '../constants/settings'
import * as ConfigGen from '../actions/config-gen'
import * as SettingsGen from '../actions/settings-gen'
import * as RPCTypes from '../constants/types/rpc-gen'
import * as Saga from '../util/saga'
import * as WaitingGen from '../actions/waiting-gen'
import {mapValues, trim} from 'lodash-es'
import {delay} from 'redux-saga'
import * as RouteTreeGen from '../actions/route-tree-gen'
import {type TypedState} from '../constants/reducer'
import {isAndroidNewerThanN, pprofDir} from '../constants/platform'

function* _onUpdatePGPSettings(): Saga.SagaGenerator<any, any> {
  try {
    const {hasServerKeys} = yield* Saga.callPromise(RPCTypes.accountHasServerKeysRpcPromise)
    yield Saga.put(SettingsGen.createOnUpdatedPGPSettings({hasKeys: hasServerKeys}))
  } catch (error) {
    yield Saga.put(SettingsGen.createOnUpdatePassphraseError({error}))
  }
}

function* _onSubmitNewEmail(): Saga.SagaGenerator<any, any> {
  try {
    yield Saga.put(SettingsGen.createWaitingForResponse({waiting: true}))

    const state = yield* Saga.selectState()
    const newEmail = state.settings.email.newEmail
    yield* Saga.callPromise(RPCTypes.accountEmailChangeRpcPromise, {
      newEmail,
    })
    yield Saga.put(SettingsGen.createLoadSettings())
    yield Saga.put(RouteTreeGen.createNavigateUp())
  } catch (error) {
    yield Saga.put(SettingsGen.createOnUpdateEmailError({error}))
  } finally {
    yield Saga.put(SettingsGen.createWaitingForResponse({waiting: false}))
  }
}

function* _onSubmitNewPassphrase(): Saga.SagaGenerator<any, any> {
  try {
    yield Saga.put(SettingsGen.createWaitingForResponse({waiting: true}))

    const state = yield* Saga.selectState()
    const {newPassphrase, newPassphraseConfirm} = state.settings.passphrase
    if (newPassphrase.stringValue() !== newPassphraseConfirm.stringValue()) {
      yield Saga.put(SettingsGen.createOnUpdatePassphraseError({error: new Error("Passphrases don't match")}))
      return
    }
    yield* Saga.callPromise(RPCTypes.accountPassphraseChangeRpcPromise, {
      force: true,
      oldPassphrase: '',
      passphrase: newPassphrase.stringValue(),
    })
    yield Saga.put(RouteTreeGen.createNavigateUp())
  } catch (error) {
    yield Saga.put(SettingsGen.createOnUpdatePassphraseError({error}))
  } finally {
    yield Saga.put(SettingsGen.createWaitingForResponse({waiting: false}))
  }
}

function* _toggleNotificationsSaga(): Saga.SagaGenerator<any, any> {
  try {
    yield Saga.put(SettingsGen.createWaitingForResponse({waiting: true}))
    const state = yield* Saga.selectState()
    const current = state.settings.notifications

    if (!current || !current.groups.email) {
      throw new Error('No notifications loaded yet')
    }

    let JSONPayload = []
    let chatGlobalArg = {}
    for (const groupName in current.groups) {
      const group = current.groups[groupName]
      if (groupName === Constants.securityGroup) {
        // Special case this since it will go to chat settings endpoint
        for (const key in group.settings) {
          const setting = group.settings[key]
          chatGlobalArg[
            `${ChatTypes.commonGlobalAppNotificationSetting[setting.name]}`
          ] = !!setting.subscribed
        }
      } else {
        for (const key in group.settings) {
          const setting = group.settings[key]
          JSONPayload.push({
            key: `${setting.name}|${groupName}`,
            value: setting.subscribed ? '1' : '0',
          })
        }
        JSONPayload.push({
          key: `unsub|${groupName}`,
          value: group.unsubscribedFromAll ? '1' : '0',
        })
      }
    }

    const [result] = yield Saga.all([
      Saga.callUntyped(RPCTypes.apiserverPostJSONRpcPromise, {
        JSONPayload,
        args: [],
        endpoint: 'account/subscribe',
      }),
      Saga.callUntyped(ChatTypes.localSetGlobalAppNotificationSettingsLocalRpcPromise, {
        settings: {
          ...chatGlobalArg,
        },
      }),
    ])
    if (!result || !result.body || JSON.parse(result.body).status.code !== 0) {
      throw new Error(`Invalid response ${result || '(no result)'}`)
    }

    yield Saga.put(SettingsGen.createNotificationsSaved())
  } finally {
    yield Saga.put(SettingsGen.createWaitingForResponse({waiting: false}))
  }
}

function* _reclaimInviteSaga(
  invitesReclaimAction: SettingsGen.InvitesReclaimPayload
): Saga.SagaGenerator<any, any> {
  const {inviteId} = invitesReclaimAction.payload
  try {
    yield* Saga.callPromise(RPCTypes.apiserverPostRpcPromise, {
      args: [{key: 'invitation_id', value: inviteId}],
      endpoint: 'cancel_invitation',
    })
    yield Saga.put(SettingsGen.createInvitesReclaimed())
  } catch (e) {
    logger.warn('Error reclaiming an invite:', e)
    yield Saga.put(
      SettingsGen.createInvitesReclaimedError({
        errorText: e.desc + e.name,
      })
    )
  }
  yield Saga.put(SettingsGen.createInvitesRefresh())
}

function* _refreshInvitesSaga(): Saga.SagaGenerator<any, any> {
  const json = yield* Saga.callPromise(RPCTypes.apiserverGetWithSessionRpcPromise, {
    args: [],
    endpoint: 'invitations_sent',
  })

  const results: {
    invitations: Array<{
      assertion: ?string,
      ctime: number,
      email: string,
      invitation_id: string,
      short_code: string,
      type: string,
      uid: string,
      username: string,
    }>,
  } = JSON.parse((json && json.body) || '')

  const acceptedInvites = []
  const pendingInvites = []

  results.invitations.forEach(i => {
    const invite: Types.Invitation = {
      created: i.ctime,
      email: i.email,
      id: i.invitation_id,
      key: i.invitation_id,
      // type will get filled in later
      type: '',
      uid: i.uid,
      // First ten chars of invite code is sufficient
      url: 'keybase.io/inv/' + i.invitation_id.slice(0, 10),
      username: i.username,
    }
    // Here's an algorithm for interpreting invitation entries.
    // 1: username+uid => accepted invite, else
    // 2: email set => pending email invite, else
    // 3: pending invitation code invite
    if (i.username && i.uid) {
      invite.type = 'accepted'
      acceptedInvites.push(invite)
    } else {
      pendingInvites.push(invite)
    }
  })
  yield Saga.put(
    // $FlowIssues the typing of this is very incorrect. acceptedInvites shape doesn't look anything like what we're pushing
    SettingsGen.createInvitesRefreshed({
      invites: {
        acceptedInvites,
        error: null,
        pendingInvites,
      },
    })
  )
}

function* _sendInviteSaga(invitesSendAction: SettingsGen.InvitesSendPayload): Saga.SagaGenerator<any, any> {
  try {
    yield Saga.put(SettingsGen.createWaitingForResponse({waiting: true}))

    const {email, message} = invitesSendAction.payload
    const args = [{key: 'email', value: trim(email)}]
    if (message) {
      args.push({key: 'invitation_message', value: message})
    }

    const response = yield* Saga.callPromise(RPCTypes.apiserverPostRpcPromise, {
      args,
      endpoint: 'send_invitation',
    })
    if (response) {
      const parsedBody = JSON.parse(response.body)
      const invitationId = parsedBody.invitation_id.slice(0, 10)
      const link = 'keybase.io/inv/' + invitationId
      yield Saga.put(
        SettingsGen.createInvitesSent()
        // {
        // NOT actually used... TODO why is this like this
        // email,
        // invitationId,
        // }
      )
      // TODO: if the user changes their route while working, this may lead to an invalid route
      yield Saga.put(
        RouteTreeGen.createNavigateAppend({path: [
          {
            props: {
              email,
              link,
            },
            selected: 'inviteSent',
          },
        ]})
      )
    }
  } catch (e) {
    logger.warn('Error sending an invite:', e)
    yield Saga.put(SettingsGen.createInvitesSentError({error: e}))
  } finally {
    yield Saga.put(SettingsGen.createWaitingForResponse({waiting: false}))
  }
  yield Saga.put(SettingsGen.createInvitesRefresh())
}

function* _refreshNotificationsSaga(): Saga.SagaGenerator<any, any> {
  // If the rpc is fast don't clear it out first
  const delayThenEmptyTask = yield Saga._fork(function*(): Generator<any, void, any> {
    yield Saga.callUntyped(delay, 500)
    yield Saga.put(
      // $FlowIssue this isn't type correct at all TODO
      SettingsGen.createNotificationsRefreshed({
        notifications: {
          groups: null,
        },
      })
    )
  })

  const [json: ?{body: string}, chatGlobalSettings: ChatTypes.GlobalAppNotificationSettings] = yield Saga.all(
    [
      Saga.callUntyped(RPCTypes.apiserverGetWithSessionRpcPromise, {
        args: [],
        endpoint: 'account/subscriptions',
      }),
      Saga.callUntyped(ChatTypes.localGetGlobalAppNotificationSettingsLocalRpcPromise),
    ]
  )
  yield Saga.cancel(delayThenEmptyTask)

  const results: {
    notifications: {
      email: {
        settings: Array<{
          name: string,
          description: string,
          subscribed: boolean,
        }>,
        unsub: boolean,
      },
      security: {
        settings: Array<{
          name: string,
          description: string,
          subscribed: boolean,
        }>,
        unsub: boolean,
      },
    },
  } = JSON.parse((json && json.body) || '')
  // Add security group extra since it does not come from API endpoint
  results.notifications[Constants.securityGroup] = {
    settings: [
      {
        description: 'Display mobile plaintext notifications',
        name: 'plaintextmobile',
        subscribed: !!chatGlobalSettings.settings[
          `${ChatTypes.commonGlobalAppNotificationSetting.plaintextmobile}`
        ],
      },
      ...(isAndroidNewerThanN
        ? []
        : [
            {
              description: 'Use mobile system default notification sound',
              name: 'defaultsoundmobile',
              subscribed: !!chatGlobalSettings.settings[
                `${ChatTypes.commonGlobalAppNotificationSetting.defaultsoundmobile}`
              ],
            },
          ]),
    ],
    unsub: false,
  }

  const settingsToPayload = s =>
    ({
      description: s.description,
      name: s.name,
      subscribed: s.subscribed,
    } || [])

  const groups = results.notifications
  const notifications = mapValues(groups, group => ({
    settings: group.settings.map(settingsToPayload),
    unsub: group.unsub,
  }))

  yield Saga.put(
    SettingsGen.createNotificationsRefreshed({
      notifications,
    })
  )
}

const _dbNukeSaga = () => Saga.callUntyped(RPCTypes.ctlDbNukeRpcPromise)

function _deleteAccountForeverSaga(action: SettingsGen.DeleteAccountForeverPayload, state: TypedState) {
  const username = state.config.username
  const allowDeleteAccount = state.settings.allowDeleteAccount

  if (!username) {
    throw new Error('Unable to delete account: no username set')
  }

  if (!allowDeleteAccount) {
    throw new Error('Account deletion failsafe was not disengaged. This is a bug!')
  }

  return Saga.sequentially([
    Saga.callUntyped(RPCTypes.loginAccountDeleteRpcPromise),
    Saga.put(ConfigGen.createSetDeletedSelf({deletedUsername: username})),
  ])
}

const loadSettings = () =>
  RPCTypes.userLoadMySettingsRpcPromise().then(settings =>
    SettingsGen.createLoadedSettings({emails: settings.emails})
  )

const _getRememberPassphrase = () => Saga.callUntyped(RPCTypes.configGetRememberPassphraseRpcPromise)
const _getRememberPassphraseSuccess = (remember: boolean) =>
  Saga.put(SettingsGen.createLoadedRememberPassphrase({remember}))

const _traceSaga = (action: SettingsGen.TracePayload) => {
  const durationSeconds = action.payload.durationSeconds
  return Saga.sequentially([
    Saga.callUntyped(RPCTypes.pprofLogTraceRpcPromise, {
      logDirForMobile: pprofDir,
      traceDurationSeconds: durationSeconds,
    }),
    Saga.put(WaitingGen.createIncrementWaiting({key: Constants.traceInProgressKey})),
    Saga.delay(durationSeconds * 1000),
    Saga.put(WaitingGen.createDecrementWaiting({key: Constants.traceInProgressKey})),
  ])
}

const _processorProfileSaga = (action: SettingsGen.ProcessorProfilePayload) => {
  const durationSeconds = action.payload.durationSeconds
  return Saga.sequentially([
    Saga.callUntyped(RPCTypes.pprofLogProcessorProfileRpcPromise, {
      logDirForMobile: pprofDir,
      profileDurationSeconds: durationSeconds,
    }),
    Saga.put(WaitingGen.createIncrementWaiting({key: Constants.processorProfileInProgressKey})),
    Saga.delay(durationSeconds * 1000),
    Saga.put(WaitingGen.createDecrementWaiting({key: Constants.processorProfileInProgressKey})),
  ])
}

const _rememberPassphraseSaga = (action: SettingsGen.OnChangeRememberPassphrasePayload) => {
  const {remember} = action.payload
  return Saga.callUntyped(RPCTypes.configSetRememberPassphraseRpcPromise, {
    remember,
  })
}

const loadLockdownMode = (state: TypedState) =>
  state.config.loggedIn &&
  RPCTypes.accountGetLockdownModeRpcPromise(undefined, Constants.waitingKey)
    .then((result: RPCTypes.GetLockdownResponse) => {
      const status = result.status
      return SettingsGen.createLoadedLockdownMode({status})
    })
    .catch(() => {
      return SettingsGen.createLoadedLockdownMode({status: null})
    })

const setLockdownMode = (state: TypedState, action: SettingsGen.OnChangeLockdownModePayload) =>
  state.config.loggedIn &&
  RPCTypes.accountSetLockdownModeRpcPromise({enabled: action.payload.enabled}, Constants.waitingKey)
    .then(() => {
      return SettingsGen.createLoadedLockdownMode({status: action.payload.enabled})
    })
    .catch(() => {
      return SettingsGen.createLoadLockdownMode()
    })

const unfurlSettingsRefresh = (state: TypedState, action: SettingsGen.UnfurlSettingsRefreshPayload) =>
  state.config.loggedIn &&
  ChatTypes.localGetUnfurlSettingsRpcPromise(undefined, Constants.chatUnfurlWaitingKey)
    .then((result: ChatTypes.UnfurlSettingsDisplay) =>
      SettingsGen.createUnfurlSettingsRefreshed({mode: result.mode, whitelist: result.whitelist || []})
    )
    .catch(() =>
      SettingsGen.createUnfurlSettingsError({
        error: 'Unable to load link preview settings, please try again.',
      })
    )

const unfurlSettingsSaved = (state: TypedState, action: SettingsGen.UnfurlSettingsSavedPayload) =>
  state.config.loggedIn &&
  ChatTypes.localSaveUnfurlSettingsRpcPromise(
    {
      mode: action.payload.mode,
      whitelist: action.payload.whitelist,
    },
    Constants.chatUnfurlWaitingKey
  )
    .then(() => SettingsGen.createUnfurlSettingsRefresh())
    .catch(() =>
      SettingsGen.createUnfurlSettingsError({
        error: 'Unable to save link preview settings, please try again.',
      })
    )

function* settingsSaga(): Saga.SagaGenerator<any, any> {
  yield Saga.safeTakeEvery(SettingsGen.invitesReclaim, _reclaimInviteSaga)
  yield Saga.safeTakeEvery(SettingsGen.invitesRefresh, _refreshInvitesSaga)
  yield Saga.safeTakeEvery(SettingsGen.invitesSend, _sendInviteSaga)
  yield Saga.safeTakeEvery(SettingsGen.notificationsRefresh, _refreshNotificationsSaga)
  yield Saga.safeTakeEvery(SettingsGen.notificationsToggle, _toggleNotificationsSaga)
  yield Saga.safeTakeEveryPure(SettingsGen.dbNuke, _dbNukeSaga)
  yield Saga.safeTakeEveryPure(SettingsGen.deleteAccountForever, _deleteAccountForeverSaga)
  yield Saga.actionToPromise(SettingsGen.loadSettings, loadSettings)
  yield Saga.safeTakeEvery(SettingsGen.onSubmitNewEmail, _onSubmitNewEmail)
  yield Saga.safeTakeEvery(SettingsGen.onSubmitNewPassphrase, _onSubmitNewPassphrase)
  yield Saga.safeTakeEvery(SettingsGen.onUpdatePGPSettings, _onUpdatePGPSettings)
  yield Saga.safeTakeEveryPure(SettingsGen.trace, _traceSaga)
  yield Saga.safeTakeEveryPure(SettingsGen.processorProfile, _processorProfileSaga)
  yield Saga.safeTakeEveryPure(
    SettingsGen.loadRememberPassphrase,
    _getRememberPassphrase,
    _getRememberPassphraseSuccess
  )
  yield Saga.safeTakeEveryPure(SettingsGen.onChangeRememberPassphrase, _rememberPassphraseSaga)
  yield Saga.actionToPromise(SettingsGen.loadLockdownMode, loadLockdownMode)
  yield Saga.actionToPromise(SettingsGen.onChangeLockdownMode, setLockdownMode)
  yield Saga.actionToPromise(SettingsGen.unfurlSettingsRefresh, unfurlSettingsRefresh)
  yield Saga.actionToPromise(SettingsGen.unfurlSettingsSaved, unfurlSettingsSaved)
}

export default settingsSaga
