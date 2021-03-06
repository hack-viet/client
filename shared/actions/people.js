// @flow
import * as ConfigGen from './config-gen'
import * as PeopleGen from './people-gen'
import * as Saga from '../util/saga'
import * as I from 'immutable'
import * as Constants from '../constants/people'
import * as Types from '../constants/types/people'
import * as RouteTreeGen from './route-tree-gen'
import * as RPCTypes from '../constants/types/rpc-gen'
import logger from '../logger'
import engine from '../engine'
import {peopleTab} from '../constants/tabs'
import {type TypedState} from '../constants/reducer'
import {getPath} from '../route-tree'

const getPeopleData = (
  state: TypedState,
  action: PeopleGen.GetPeopleDataPayload | ConfigGen.LoggedInPayload
) => {
  // more logging to understand why this fails so much
  logger.info(
    'getPeopleData: appFocused:',
    state.config.appFocused,
    'loggedIn',
    state.config.loggedIn,
    'action',
    action
  )
  let markViewed = false
  let numFollowSuggestionsWanted = Constants.defaultNumFollowSuggestions
  if (action.type === PeopleGen.getPeopleData) {
    markViewed = action.payload.markViewed
    numFollowSuggestionsWanted = action.payload.numFollowSuggestionsWanted
  }
  return RPCTypes.homeHomeGetScreenRpcPromise(
    {markViewed, numFollowSuggestionsWanted},
    Constants.getPeopleDataWaitingKey
  )
    .then((data: RPCTypes.HomeScreen) => {
      const following = state.config.following
      const followers = state.config.followers
      const oldItems: I.List<Types.PeopleScreenItem> = (data.items || [])
        .filter(item => !item.badged && item.data.t !== RPCTypes.homeHomeScreenItemType.todo)
        .reduce(Constants.reduceRPCItemToPeopleItem, I.List())
      let newItems: I.List<Types.PeopleScreenItem> = (data.items || [])
        .filter(item => item.badged || item.data.t === RPCTypes.homeHomeScreenItemType.todo)
        .reduce(Constants.reduceRPCItemToPeopleItem, I.List())

      const followSuggestions: I.List<Types.FollowSuggestion> = (data.followSuggestions || []).reduce(
        (list, suggestion) => {
          const followsMe = followers.has(suggestion.username)
          const iFollow = following.has(suggestion.username)
          return list.push(
            Constants.makeFollowSuggestion({
              followsMe,
              fullName: suggestion.fullName,
              iFollow,
              username: suggestion.username,
            })
          )
        },
        I.List()
      )

      return PeopleGen.createPeopleDataProcessed({
        followSuggestions,
        lastViewed: new Date(data.lastViewed),
        newItems,
        oldItems,
        version: data.version,
      })
      // never throw black bars
    })
    .catch(e => {})
}

const dismissAnnouncement = (_, action: PeopleGen.DismissAnnouncementPayload) =>
  RPCTypes.homeHomeDismissAnnouncementRpcPromise({
    i: action.payload.id,
  })

const markViewed = () =>
  RPCTypes.homeHomeMarkViewedRpcPromise().catch(err => {
    if (networkErrors.includes(err.code)) {
      logger.warn('Network error calling homeMarkViewed')
    } else {
      throw err
    }
  })

const skipTodo = (_, action: PeopleGen.SkipTodoPayload) =>
  RPCTypes.homeHomeSkipTodoTypeRpcPromise({
    t: RPCTypes.homeHomeScreenTodoType[action.payload.type],
  }).then(() =>
    // TODO get rid of this load and have core send us a homeUIRefresh
    PeopleGen.createGetPeopleData({
      markViewed: false,
      numFollowSuggestionsWanted: Constants.defaultNumFollowSuggestions,
    })
  )

let _wasOnPeopleTab = false
const setupEngineListeners = () => {
  engine().actionOnConnect('registerHomeUI', () => {
    RPCTypes.delegateUiCtlRegisterHomeUIRpcPromise()
      .then(() => console.log('Registered home UI'))
      .catch(error => console.warn('Error in registering home UI:', error))
  })

  engine().setIncomingCallMap({
    'keybase.1.homeUI.homeUIRefresh': () =>
      _wasOnPeopleTab &&
      Saga.put(
        PeopleGen.createGetPeopleData({
          markViewed: false,
          numFollowSuggestionsWanted: Constants.defaultNumFollowSuggestions,
        })
      ),
  })
}

const onNavigateTo = (state: TypedState, action: RouteTreeGen.NavigateAppendPayload) => {
  const list = I.List(action.payload.path)
  const root = list.first()
  const peoplePath = getPath(state.routeTree.routeState, [peopleTab])
  if (root === peopleTab && peoplePath.size === 2 && peoplePath.get(1) === 'profile' && _wasOnPeopleTab) {
    // Navigating away from the people tab root to a profile page.
    return Promise.resolve(PeopleGen.createMarkViewed())
  }
  return false
}

const onTabChange = (state: TypedState, action: RouteTreeGen.SwitchToPayload) => {
  // TODO replace this with notification based refreshing
  const list = I.List(action.payload.path)
  const root = list.first()
  const peoplePath = getPath(state.routeTree.routeState, [peopleTab])

  if (root !== peopleTab && _wasOnPeopleTab && peoplePath.size === 1) {
    _wasOnPeopleTab = false
    return Promise.resolve(PeopleGen.createMarkViewed())
  } else if (root === peopleTab && !_wasOnPeopleTab) {
    _wasOnPeopleTab = true
  }
  return false
}

const networkErrors = [
  RPCTypes.constantsStatusCode.scgenericapierror,
  RPCTypes.constantsStatusCode.scapinetworkerror,
  RPCTypes.constantsStatusCode.sctimeout,
]

const peopleSaga = function*(): Saga.SagaGenerator<any, any> {
  yield Saga.actionToPromise(PeopleGen.getPeopleData, getPeopleData)
  yield Saga.actionToPromise(PeopleGen.markViewed, markViewed)
  yield Saga.actionToPromise(PeopleGen.skipTodo, skipTodo)
  yield Saga.actionToPromise(RouteTreeGen.switchTo, onTabChange)
  yield Saga.actionToPromise(RouteTreeGen.navigateTo, onNavigateTo)
  yield Saga.actionToPromise(PeopleGen.dismissAnnouncement, dismissAnnouncement)
  yield Saga.actionToAction(ConfigGen.setupEngineListeners, setupEngineListeners)
}

export default peopleSaga
