var token = ''

// the backdrop
var backdrop = $('<div class="kamino-backdrop fade in"></div>');

// repo list
var repoList = []

// don't try to re initialize the extension if there's a token in memory
if (token === '') {
  // load jquery via JS
  $.getScript('https://cdnjs.cloudflare.com/ajax/libs/jquery/3.2.0/jquery.min.js', () => {
    setInterval(() => { initializeExtension() }, 1000)
  })
}

function initializeExtension() {
  // if there's already a button on the screen, exit
  if ($('.kaminoButton').length > 0) {
    return
  }

  // the button
  const newBtn = $(Handlebars.templates.button().replace(/(\r\n|\n|\r)/gm,""))

  // the modal
  const context = {confirmText: 'Are you sure you want to clone this issue to another repository? Choose whether to clone and close or clone and keep the original issue open.'}
  const popup = $(Handlebars.templates.modal(context).replace(/(\r\n|\n|\r)/gm,""))

  // get url
  const urlObj = populateUrlMetadata()

  // if the page is not a pull request page(view or create)
  // and the page is not a new issue page
  // and there is no Kamino button in the DOM, proceed
  if (urlObj.url.indexOf(urlObj.organization + '/' + urlObj.currentRepo + '/compare/') < 0 &&
    urlObj.url.indexOf(urlObj.organization + '/' + urlObj.currentRepo + '/pull/') < 0 &&
    urlObj.url.indexOf(urlObj.organization + '/' + urlObj.currentRepo + '/issues/new') < 0 &&
    $('.kaminoButton').length === 0) {

    // look for any applied issue filters
    saveAppliedFilters(urlObj)

    // append button and modal to DOM
    $(newBtn).insertBefore($('.sidebar-assignee'))
    $(popup).insertBefore($('.sidebar-assignee'))

    // remove the open class just to be sure
    $('.btn-group').removeClass('open');

    // load the token
    chrome.storage.sync.get({
      githubToken: ''
    }, (item) => {
      token = item.githubToken
      // grab the PAT
      if ($('.kaminoButton').length > 0) {
        loadRepos()
      }
    })

    $('.kaminoButton').click(() => {
      // make sure the bootstrap dropdown opens and closes properly
      openDropdown()
    })

    $('.quickClone').click(() => {
      if ($('.quickClone').attr('data-repo') === undefined) {
        openDropdown()
      }
      else {
        itemClick($('.quickClone').attr('data-repo'))
      }
    })

    $('.cloneAndClose').click(() => {
      closeModal()
      getGithubIssue($('.cloneAndClose').attr('data-repo'), true)
    })

    $('.cloneAndKeepOpen').click(() => {
      closeModal()
      getGithubIssue($('.cloneAndKeepOpen').attr('data-repo'), false)
    })

    $('.close').click(() => {
      closeModal()
    })

    $('.noClone').click(() => {
      closeModal()
    })
  }
}

function saveAppliedFilters(urlObj) {
  // check for the appropriate url
  // url should have /issues and should not track any url that has an issue number at the end
  if (urlObj.url.indexOf('/issues') > 0 && isNaN(urlObj.issueNumber)) {
    // save the filter querystring for when/if we navigate back
    var url = urlObj.url
    var querystring = url.substring(url.indexOf('/issues'))

    // filter object stores the querystring, the organization and the repo
    var filter = {
      filter: querystring,
      organization: urlObj.organization,
      currentRepo: urlObj.currentRepo
    }

    chrome.storage.sync.get({
      filters: []
    }, (item) => {

      var exists = false;
      var changed = false;

      // convert the string to an empty array for existing users
      if (typeof item.filters === 'string') {
        item.filters = []
      }

      item.filters.forEach((f) => {
        // if the storage array contains the org and repo, then set exists flag
        if (f.organization === filter.organization && f.currentRepo === filter.currentRepo) {
          exists = true

          // if the querystring value has changed, set the changed flag and update the filter
          if (f.filter !== filter.filter) {
            changed = true
            f.filter = filter.filter
          }
        }
      })

      // if the filter doesn't exist, push to the array and set changed
      if (!exists) {
        changed = true
        item.filters.push(filter)
      }

      // only save if changed, otherwise the max quota per minute will be exceeded throwing errors
      if (changed) {
        chrome.storage.sync.set({
          filters: item.filters
        }, () => { console.log('filters saved') })
      }
    })
  }
}

function getRepos(url) {
  return new Promise((resolve, reject) => {
    return ajaxRequest('GET', '', url).then((repos) => {
      repoList = repoList.concat(repos.data)
      // does the user have more repos
      var linkstring = repos.header.getResponseHeader('Link')
      if (linkstring) {
        var linkArray = linkstring.split(',')
        linkArray.forEach((link) => {
          if (link.indexOf('rel="next"') > -1) {
            const re = /\<(.*?)\>/
            resolve(getRepos(link.match(re)[1]))
          }
        })

        resolve(null)
      } else {
        resolve(null)
      }
    })
  })
}

function loadRepos() {
  // if there's no personal access token, disable the button
  if (token === '') {
    console.log('disabling button because there is no Personal Access Token for authentication with Github')
    $(".kaminoButton").prop('disabled', true)
    $(".quickClone").prop('disabled', true)
  }

  repoList = []
  const urlObj = populateUrlMetadata()

  // clear the list each time to avoid duplicates
  $('.repoDropdown').empty()

  getRepos('https://api.github.com/user/repos?per_page=100').then((test) => {
    // move the items from most used to the top
    chrome.storage.sync.get({
      mostUsed: []
    }, (item) => {
      // check for a populated list
      if (item.mostUsed && item.mostUsed.length > 0) {
        $('.quickClone').attr('data-repo', item.mostUsed[0]);
        $('.quickClone').text('Clone to ' + item.mostUsed[0].substring(item.mostUsed[0].indexOf('/') + 1))

        // add separator header
        $('.repoDropdown').append('<li class="dropdown-header">Last Used</li>')

        item.mostUsed.forEach((repoFull) => {
          // remove organization
          var repo = repoFull.substring(repoFull.indexOf('/') + 1)

          addRepoToList(repoFull, repo)

          // remove the item from the main repos list
          repoList = repoList.filter((i) => {
            return i.full_name !== repoFull
          })
        })

        // add separator header
        $('.repoDropdown').append('<li class="dropdown-header">The Rest</li>')
      }
      else {
        $('.quickClone').text('Clone to');
      }

      // sort the repo
      repoList = repoList.sort((a, b) => a.full_name.localeCompare(b.full_name))

      // remove the repo you're currently on
      repoList = repoList.filter((i) => {
        return i.name !== urlObj.currentRepo
      })

      repoList.forEach((repo) => {
        addRepoToList(repo.full_name, repo.name);
      })
    })
  })
}

function getGithubIssue(repo, closeOriginal) {
  const urlObj = populateUrlMetadata()

  ajaxRequest('GET', '', 'https://api.github.com/repos/' + urlObj.organization + '/' + urlObj.currentRepo + '/issues/' + urlObj.issueNumber).then((issue) => {
    // build new issue
    const newIssue = {
      title: issue.data.title,
      body: 'From ' + urlObj.currentRepo + ' created by [' + issue.data.user.login + '](' + issue.data.user.html_url + ') : ' + urlObj.organization + '/' + urlObj.currentRepo + '#' + urlObj.issueNumber + "  \n\n" + issue.data.body,
      labels: issue.data.labels
    }

    createGithubIssue(newIssue, repo, issue.data, closeOriginal)
  })
}

// create the cloned GitHub issue
function createGithubIssue(newIssue, repo, oldIssue, closeOriginal) {
  ajaxRequest('POST', newIssue, 'https://api.github.com/repos/' + repo + '/issues').then((response) => {
    // add a comment to the closed issue
    commentOnIssue(repo, oldIssue, response.data, closeOriginal)
  })
}

function closeGithubIssue(oldIssue) {
  const issueToClose = {
    state: 'closed'
  }

  const urlObj = populateUrlMetadata()

  ajaxRequest('PATCH', issueToClose, 'https://api.github.com/repos/' + urlObj.organization + '/' + urlObj.currentRepo + '/issues/' + urlObj.issueNumber).then((done) => {
  })
}

function commentOnIssue(repo, oldIssue, newIssue, closeOriginal) {
  const urlObj = populateUrlMetadata()

  const comment = {
    body: closeOriginal ? 'Kamino closed and cloned this issue to ' + repo : 'Kamino cloned this issue to ' + repo
  }

  ajaxRequest('POST', comment, 'https://api.github.com/repos/' + urlObj.organization + '/' + urlObj.currentRepo + '/issues/' + urlObj.issueNumber + '/comments').then((response) => {

    if (closeOriginal) {
      // if success, close the existing issue and open new in a new tab
      closeGithubIssue(oldIssue)
    }
    goToIssueList(repo, newIssue.number, urlObj.organization, urlObj.currentRepo)
  })
}

function goToIssueList(repo, issueNumber, org, oldRepo) {
  // based on user settings, determines if the issues list will open after a clone or not
  chrome.runtime.sendMessage({ repo: repo, issueNumber: issueNumber, organization: org, oldRepo: oldRepo }, (response) => {
  })
}

function ajaxRequest(type, data, url) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get({
      githubToken: ''
    }, (item) => {
      token = item.githubToken
      $.ajax({
        type: type,
        beforeSend: (request) => {
          request.setRequestHeader('Authorization', 'token ' + token)
          request.setRequestHeader('Content-Type', 'application/json')
        },
        data: JSON.stringify(data),
        url: url
      }).done((data, status, header) => {
        resolve({
          data: data,
          status: status,
          header: header
        })
      })
    })
  })
}

function addRepoToList(repoFullName, repo) {
  // add the repo to the list
  $('.repoDropdown').append('<li data-toggle="modal" id="' + repo.replace('.', '_') + '" data-target="#kaminoModal"><a class="repoItem" href="#">' + repoFullName + '</a></li>')
  $('#' + repo.replace('.', '_')).bind('click', () => { itemClick(repoFullName) })
}

function populateUrlMetadata() {
  var url = document.location.href
  const urlArray = url.split('/')
  const currentRepo = urlArray[4]
  const organization = urlArray[3]
  const issueNumber = urlArray[urlArray.length - 1].replace('#', '')

  const urlObject = {
    url: url,
    currentRepo: currentRepo,
    organization: organization,
    issueNumber: issueNumber
  }

  return urlObject
}

function addToMostUsed(repo) {
  // get
  chrome.storage.sync.get({
    mostUsed: []
  }, (item) => {
    // find the item
    if (item.mostUsed.find((e) => { return e === repo }) !== undefined) {
      // if exists, get index
      var index = item.mostUsed.indexOf(repo);

      // remove
      item.mostUsed.splice(index, 1)

      // add to top
      item.mostUsed.unshift(repo)

      // pop the last if item count is more than 5
      if (item.mostUsed.length > 5) {
        item.mostUsed.pop()
      }
    }
    else {
      // add to top
      item.mostUsed.unshift(repo)

      // pop the last if item count is more than 5
      if (item.mostUsed.length > 5) {
        item.mostUsed.pop()
      }
    }

    // save
    chrome.storage.sync.set({
      mostUsed: item.mostUsed
    }, (done) => {

    })
  })
}

function openDropdown() {
  if ($('.btn-group').hasClass('open')) {
    $('.btn-group').removeClass('open')
  }
  else {
    $('.btn-group').addClass('open')
  }
}

function itemClick(repo) {
  // add the item to the most used list
  addToMostUsed(repo)

  $('.cloneAndClose').attr('data-repo', repo)
  $('.cloneAndKeepOpen').attr('data-repo', repo)
  $('.confirmText').text('Are you sure you want to clone this issue to ' + repo + '? Choose whether to clone and close or clone and keep the original issue open.')
  openModal()
}

function closeModal() {
  // make sure the modal closes properly
  $('.kamino-backdrop').remove();
  $('#kaminoModal').removeClass('in')
  $('#kaminoModal').css('display', '')
}

function openModal() {
  $('#kaminoModal').addClass('in')
  $('#kaminoModal').css('display', 'block')
  $('#js-repo-pjax-container').append(backdrop);
}