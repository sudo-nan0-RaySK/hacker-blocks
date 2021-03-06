import Ember from 'ember';
import config from '../../../config/environment';
import getSnippet from '../../../utils/get-snippet';

function startLoading() {
  $('.runner').addClass('disabled');
}

function stopLoading() {
  $('.runner').removeClass('disabled');
  $('.runner').button('reset');
}

function judge(component, problemId, contestId, noScore, headers) {
  startLoading();

  let authHeaders = component.get('currentUser').getAuthHeaders();
  let submission = {
    user_id: component.get('session.data.authenticated.user_id'),
    language: component.get('langId'),
    problemId: problemId,
    contestId: contestId,
    source: window.btoa(ace.edit("editor").getValue()),
    custom_input: window.btoa($('#custom-input').val()),
    no_score: noScore
  };

  $.ajax({
    url: config.apiEndpoint + '/api/submissions',
    data: JSON.stringify(submission),
    type: "POST",
    headers: authHeaders,
    contentType: "application/json"
  }).done(function(data) {

    let pollCount = 0,
      maxPollCount = 24,
      pollInterval = 5000,
      submissionId = data.submissionId
    ;

    let pollForResult = setInterval (function () {
      pollCount += 1

      if (pollCount === maxPollCount) {
        Raven.context (
          { extra: { submissionId: data.submissionId } },
          function () {
            Raven.captureException (new Error ('Submission polling cycle ended, got no response'));
          }
        );

        component.set ('result', 'output');
        component.set ('output', 'WW91ciBzdWJtaXNzaW9uIGlzIGJlaW5nIGp1ZGdlZC4gUGxlYXNlIGNoZWNrIHlvdXIgc3VibWlzc2lvbnMgaW4gYSBmZXcgbWludXRlcyBmb3IgdGhlIHJlc3VsdC4K');

        stopLoading();
        clearInterval (pollForResult);
      }

      $.ajax ({
        url: config.apiEndpoint + '/api/submissions/result/' + data.submissionId,
        type: "GET",
        headers: component.get('currentUser').getAuthHeaders(),
        contentType: "application/json",
        timeout: 200000
      })
        .done (function (response) {
          if ((! response) || (! response.judge_result)) {
            return
          }

          let submission = response.judge_result

          component.set ('explanation', response.explanation)
          component.set ('submissionId', data.submissionId)

          clearInterval (pollForResult);

          component.sendAction('refreshModel');
          stopLoading();

          if (submission.result === "compile_error") {
            component.set('output', window.atob(submission.error));
          }
          else {
            if (problemId === undefined) {
              submission.result = 'output';
              component.set('output', submission.data.output);
            } else {
              component.set('output', submission.data.testcases);
            }
          }
          component.set('result', submission.result);

          if (response.certificate_earned) {
            if (! response.level) {
              let finishedModal = $('#finishedModal')
              finishedModal.modal ('show')
            }
            else {
              component.set ('level', response.level)

              let certificateModal = $('#certificateModal')
              certificateModal.modal ('show')
            }
          }
        })
        .fail (function (error) {
          Raven.captureException (error)
        })

    }, pollInterval)

  }).fail(function(jqXHR, textStatus, errorThrown) {
    const statusCode = jqXHR.status

    if (statusCode === 401) {
      component.set ('result', 'auth_error');
    }
    else {
      component.set('result', 'error');
    }

    stopLoading();
  });
}
export default Ember.Component.extend({
  session: Ember.inject.service('session'),
  currentUser: Ember.inject.service('current-user'),
  output: "",
  result: "",
  langId: Ember.computed('allowedLanguages.[]',function(){
      return this.get('allowedLanguages') ? this.get('allowedLanguages').objectAt(0) : "cpp";
  }),
  onceEdit: false,
  customInput: false,
  initRenderDone: false,
  theme: "ace/theme/monokai",
  theme_codes: {
    "dark": {
      name: "Monokai",
      mode: "ace/theme/monokai"
    },
    "light": {
      name: "Solarized",
      mode: "ace/theme/solarized_light"
    }
  },
  lang_codes: {
    "cpp": {
      name: "C++",
      mode: "ace/mode/c_cpp"
    },
    "c": {
      name: "C",
      mode: "ace/mode/c_cpp"
    },
    "py2": {
      name: "Python 2.7",
      mode: "ace/mode/python"
    },
    "py3": {
      name: "Python 3",
      mode: "ace/mode/python"
    },
    "java": {
      name: "Java 8",
      mode: "ace/mode/java"
    },
    "js": {
      name: "Node 10",
      mode: "ace/mode/javascript"
    },
    "csharp": {
      name: "C#",
      mode: "ace/mode/csharp"
    },
  },
  stub: Ember.computed('langId', 'problem.solutionStubs.[]', function () {
    let langId = this.get('langId')
    let stub;
    if (this.get('problem.solutionStubs') != undefined) {
      stub = this.get('problem.solutionStubs')
        .filter(
          (stub, index) => stub.get('language') === langId
        )
        .mapBy('body')
        .get('firstObject');
    }

    return (stub || getSnippet(langId))
  }),

  init () {
    this._super (...arguments)

    const allowedLanguages = this.get ('allowedLanguages')

    if (allowedLanguages && allowedLanguages.includes ('py2')) {
      allowedLanguages.push ('py3')
    }
  },

  didRender() {
    let editor = ace.edit("editor");
    let self = this;

    if (this.get('initRenderDone') == false) {
      editor.setValue(this.get('stub'));
      this.set('initRenderDone', true);
    }

    editor.textInput.getElement().onkeyup = function (event) {
      self.set("onceEdit", true);
    };
  },

  actions: {
    themeChange() {
      let theme = $('#themeSelect :selected').val();
      this.set('theme', this.get('theme_codes')[theme]["mode"]);
      let editor = ace.edit("editor");
      editor.setTheme(this.get('theme'));
    },

    langChange () {
      let langId = $('#langSelect :selected').val();

      this.set('langId', langId)

      $("#editor-lang").text(this.lang_codes[langId]["name"]);
      let editor = ace.edit("editor");
      editor.getSession().setMode(this.lang_codes[langId]["mode"]);

      if (! this.get("onceEdit")) {
        editor.setValue(this.get('stub'));
      }
    },

    submit(problem, noScore) {
      $('#submit').button('loading');
      judge(this, problem.id, this.get('contestId'), noScore);
    },
    run() {
      $('#run').button('loading');
      judge(this);
    },

    reset() {
      let langId = $('#langSelect :selected').val();
      let editor = ace.edit("editor");
      editor.setValue(this.get('stub'));
      this.set("onceEdit", false);
      $('#custom-input').val("");
      this.set('customInput', false);
      this.set("result", null);
      this.set("output", null);
    },

    customInput() {
      if (this.get('customInput') === true) {
        this.set('customInput', false);
      } else {
        this.set('customInput', true);

        Ember.run.later (() => {
          let customInputField = document.querySelector ('#custom-input')
          customInputField.focus ()
          customInputField.select ()
        })
      }
    },

    popup() {
      var redirectionPath = window.location.pathname;
      redirectionPath = redirectionPath.replace(/^\/|\/$/g, '');
      localStorage.setItem('redirection-path', redirectionPath);
      window.location = "https://account.codingblocks.com/oauth/authorize?" +
        "response_type=code" +
        "&client_id=" + config.oneauthClientId +
        "&redirect_uri=" + config.publicUrl
      },

  }
});
