<template>
  <div class="play-container">
    <div class="container-fluid">
      <div class="doc-section doc-section-play" style="text-align:left" id="competition-rules">
        <h2 class="mt3" style="text-align: center">COMPETITION RULES</h2>
        <p>
        <p style="text-align: center"><b>Start date:</b> October 16, 2018</p>
        <p style="text-align: center"><b>Submissions end:</b> January 22, 2019 at 11:59pm EST (GMT-05:00)</p>
        <p style="text-align: center"><b>Winners announced:</b> January 29th</p>

        <br/>
        <h4 class="mt3">Eligibility</h4>
        <p>The competition is open to the public, free to enter, and encourages professionals and students from all over the world to join in. Create an account and submit a bot during the dates of the competition to appear on the leaderboard.
        </p>
        <br/>
        <h4 class="mt3">Ranking</h4>
        <p>Rankings are based on the outcome of organized games where bots play against each other. Your bot moves up the leaderboard as you submit improved versions. When you submit a new version, your ranking is reset to a degree. After some games played, your bot should reach its new accurate ranking. Read more about the ranking system used <a href="https://forums.halite.io/t/how-ratings-get-calculated-for-halite-iii/95">here</a>. <!--, and learn more about our Bot Bosses here.-->
        </p>
        <p>Tiers are based on the percentile rank. The top 1% of players are considered Diamond; the next 5% are considered Platinum, then the next 10% are Gold, 25% are Silver, and the rest are Bronze.
        </p>
        <br/>
        <h4 class="mt3">Winning</h4>
        <p>Last submissions are due at midnight EST (GMT-05:00) on January 22nd, and bots will run through the following week to compute rankings. The winners are the highest ranked players on the leaderboard at the end of this “Finals” period. We will freeze the scores and leaderboard and announce the winners on January 29th.
        </p>
        <p>The top players will receive Halite apparel and awesome Halite trophies.
        </p>
        <br/>
        <h4 class="mt3">Accounts</h4>
        <p>Each player may have one account and may submit one bot to the competition. You may not have an individual account and a team account. Multiple accounts are considered rule-breaking, and may be deleted and/or banned at the Halite team’s discretion.</p>
        <br/>
        <h4 class="mt3" id="rules-teams">Teams</h4>
        <p>Players may form teams and create bots together this year. Creating or joining a team is a <b>permanent</b> conversion for your account. Only the team leader may submit a bot.
        </p>
        <p>To form a new team and become a team leader, go to your profile page, edit your profile, and choose your team name. Your account will be converted to a team account and you will get a shareable invite link to invite your team members.
        </p>
        <p>To join a team, insert your invite code on your profile.
        </p>
        <br/>
        <h4 class="mt3">Original Code</h4>
        <p>You are expected to write original code for Halite III. <b>Plagiarism is not tolerated.</b> You are permitted to use any code found in official documentation, tutorials, and starter kits from the Halite III repository. But if you submit code written by another Halite player (even if it has been posted publicly), your account may be deleted from the leaderboard and/or banned.</p>
        <br/>
      </div>
    </div>
  </div>
</template>
<script>
  import * as api from '../api'
  import Vue from 'vue'
  import HaliteBreadcrumb from './Breadcrumb.vue'
  import VisualizerContainer from './VisualizerContainer.vue'
  import Message from './Message.vue'
  import {Alert} from '../utils.js'
  import UploadZone from './UploadZone.vue'
  import Visualizer from './Visualizer.vue'
  import * as utils from '../utils'

  // showing game
  let visualizer = null
  const showGame = (game) => {
  if (visualizer && visualizer.getVisualizer) {
    visualizer.getVisualizer().destroy()
  }

  const buffer = game.replay
  return import(/* webpackChunkName: "libhaliteviz" */ "libhaliteviz")
    .then((libhaliteviz) => {
      // just for electron
      if (window && window.process && window.process.type) {
        return libhaliteviz.setAssetRoot('assets/js/').then(() => libhaliteviz)
      }
      return libhaliteviz.setAssetRoot('').then(() => libhaliteviz)
    }).then((libhaliteviz) => {
      return libhaliteviz.parseReplay(buffer).then((replay) => {
        let outerContainer = document.querySelector('.play-container > .container-fluid')
        outerContainer.innerHTML = ''

        let container = document.createElement('div')
        outerContainer.appendChild(container)

        new Vue({
          el: container,
          render: (h) => h(Visualizer, {
            props: {
              replay: Object.freeze(replay),
              game: game.game,
            }
          }),
          mounted: function () {
            window.scrollTo(0, 0);
            visualizer = this.$children[0]
          }
        })
      })
    });
}

  export default {
    name: 'uploader',
    props: ['baseUrl'],
    components: {
      'visualizer-container': VisualizerContainer,
      'halite-upload-zone': UploadZone,
      HaliteBreadcrumb
    },
    data: function () {
      return {
        currentView: 'upload',
        replayFile: '',
        botFile: {name: ''},
        loggedIn: false,
        user: null,
        displayMessage: false,
        message: '',
        is_downloading: false,
        uploadProgress: null,
        uploadMessage: null,
        path: [
          {
            name: 'Back',
            link: '/play-programming-challenge'
          }
        ]
      }
    },
    mounted: function () {
     // handle whole page drag and drop
      const ins = this
      $('body').on('drop dragdrop', (e) => {
        // verify if the dropzone is not the bot uploader zone
        const files = e.originalEvent.dataTransfer.files
        if (files.length > 0) {
          e.preventDefault()

          const [f] = files;
          if (f) { // f.type === "application/zip"
            Vue.set(ins, 'botFile', f)
            Vue.set(ins, 'currentView', 'botUpload')
            Vue.nextTick(() => {
              if (ins.$refs.botUploadComponent) {
                ins.$refs.botUploadComponent.validateBot()
              }
            })
          }
        }
      })
      $('body').on('dragenter', (e) => {
        // get the bot uploader container
        const container = document.getElementById('bot-upload-container')
        if (!container || !container.contains(e.target)) {
          e.preventDefault()
        }
      })
      $('body').on('dragover', (e) => {
        // get the bot uploader container
        const container = document.getElementById('bot-upload-container')
        if (!container || !container.contains(e.target)) {
          e.preventDefault()
        }
      });
  },
    methods: {
      showMessage: function (type = 'success', content) {
        if (content === null) {
          Alert.hide()
        }
        else {
          Alert.show(content, type)
        }
      },
      play_replay: function (files) {
        this.gaData('play', 'select-replay-file-another', 'replay-flow')
        if (files.length > 0) {
          const reader = new FileReader()
          const inst = this
          reader.onload = (e) => {
            inst.is_upload = false
            inst.currentView = 'replay'
            inst.replayFile = files[0].name
            window.location.hash = '/replay-bot'
            // inst.message = 'Parsing replay, please wait…'
            inst.message = 'Almost done...'
            showGame({
              game: null,
              replay: e.target.result
            }).then(() => {
              this.message = null
            }).catch(() => {
              this.message = 'There was an error parsing the replay. To resolve the issue, try hard refreshing the page with Ctrl + F5 (Windows) or Command + Shift + R (Mac).'
            })
          }
          reader.readAsArrayBuffer(files[0])
        }
      },
      gaData: function (category, action, label) {
        utils.gaEvent(category, action, label)
      },
    }
  }
</script>

<style lang="scss" scoped>
  $primary-blue-text: #033C89;
  $primary-black-text: #414141;
  $text-content-color: #52678D;
  .mt3 {
    color: $primary-blue-text;
    font-size: 24px;
    line-height: 29px;
  }
  .sub-title {
    color: $primary-black-text;
    margin-top: 10px;
    margin-bottom: 25px;
    font-size: 20px;
  }
  .text-content {
    color: $text-content-color;
    font-size: 18px;
    line-height: 27px;
    letter-spacing: 0.12px;
  }
</style>
