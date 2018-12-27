// @flow
import {makeRouteDefNode, makeLeafTags} from '../route-tree'
import {isMobile} from '../constants/platform'

const profileRoute = () => {
  const pgpRoutes = require('./pgp/routes').default
  const Profile = require('./container').default
  const AddToTeam = require('./add-to-team/container').default
  const EditProfile = require('./edit-profile/container').default
  const EditAvatar = require('./edit-avatar/container').default
  const EditAvatarPlaceholder = require('./edit-avatar-placeholder/container').default
  const ProveEnterUsername = require('./prove-enter-username/container').default
  const ProveWebsiteChoice = require('./prove-website-choice/container').default
  const RevokeContainer = require('./revoke/container').default
  const PostProof = require('./post-proof/container').default
  const ConfirmOrPending = require('./confirm-or-pending/container').default
  const SearchPopup = require('./search/container').default
  const NonUserProfile = require('./non-user-profile/container').default
  const ShowcaseTeamOffer = require('./showcase-team-offer/container').default
  const ControlledRolePicker = require('../teams/role-picker/controlled-container').default
  const WalletConstants = require('../constants/wallets')
  const SendForm = require('../wallets/send-form/container').default
  const ConfirmForm = require('../wallets/confirm-form/container').default
  const ChooseAsset = require('../wallets/send-form/choose-asset/container').default
  const QRScan = require('../wallets/qr-scan/container').default

  const proveEnterUsername = makeRouteDefNode({
    children: {
      confirmOrPending: {
        component: ConfirmOrPending,
      },
      postProof: {
        children: {
          confirmOrPending: {
            component: ConfirmOrPending,
          },
        },
        component: PostProof,
      },
    },
    component: ProveEnterUsername,
  })

  return makeRouteDefNode({
    children: {
      addToTeam: {
        children: {
          controlledRolePicker: {
            children: {},
            component: ControlledRolePicker,
            tags: makeLeafTags({layerOnTop: !isMobile}),
          },
        },
        component: AddToTeam,
        tags: makeLeafTags({layerOnTop: !isMobile}),
      },
      editAvatar: {
        component: EditAvatar,
        tags: makeLeafTags({layerOnTop: !isMobile}),
      },
      editAvatarPlaceholder: {
        component: EditAvatarPlaceholder,
      },
      editProfile: {
        component: EditProfile,
      },
      nonUserProfile: {
        children: {
          profile: profileRoute,
        },
        component: NonUserProfile,
      },
      pgp: pgpRoutes,
      profile: profileRoute,
      proveEnterUsername,
      proveWebsiteChoice: {
        children: {
          proveEnterUsername,
        },
        component: ProveWebsiteChoice,
      },
      revoke: {
        component: RevokeContainer,
      },
      search: {
        children: {},
        component: SearchPopup,
        tags: makeLeafTags({layerOnTop: !isMobile}),
      },
      showcaseTeamOffer: {
        children: {},
        component: ShowcaseTeamOffer,
        tags: makeLeafTags({layerOnTop: !isMobile}),
      },
      [WalletConstants.sendReceiveFormRouteKey]: {
        children: {
          [WalletConstants.confirmFormRouteKey]: {
            children: {},
            component: ConfirmForm,
            tags: makeLeafTags({layerOnTop: !isMobile, renderTopmostOnly: true, underNotch: true}),
          },
          [WalletConstants.chooseAssetFormRouteKey]: {
            children: {},
            component: ChooseAsset,
            tags: makeLeafTags({hideStatusBar: true, layerOnTop: !isMobile, renderTopmostOnly: true}),
          },
          qrScan: {
            component: QRScan,
            tags: makeLeafTags({layerOnTop: true, underNotch: true}),
          },
        },
        component: SendForm,
        tags: makeLeafTags({layerOnTop: !isMobile, renderTopmostOnly: true, underNotch: true}),
      },
    },
    component: Profile,
    initialState: {currentFriendshipsTab: 'Followers'},
    tags: makeLeafTags({title: 'Profile', underNotch: true}),
  })
}

export default profileRoute
