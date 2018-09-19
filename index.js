#! /usr/bin/env node
const meow = require('meow')
const git = require('simple-git/promise')
const differenceInMilliseconds = require('date-fns/difference_in_milliseconds')
const prettyMs = require('pretty-ms')
const chalk = require('chalk')
const ghGot = require('gh-got')

const cli = meow(`
  Usage
    $ git-report-card <author name>
    
  Options
    --dir, -d Path to git directory
    --github, -gh Github stats will be printed
    --github-repo, -ghr Github repo to get stats from
    --github-user, -ghu Github username
    --token, -t Github API token
`, {
  flags: {
    dir: {
      type: 'string',
      alias: 'd',
      default: '.'
    },

    github: {
      type: 'boolean',
      alias: 'gh',
      default: false
    },

    'github-user': {
      type: 'string',
      alias: 'ghu'
    },

    'github-repo': {
      type: 'string',
      alias: 'ghr'
    },

    'token': {
      type: 'string',
      alias: 't'
    }
  }
})

const [authorName] = cli.input
const githubUser = cli.flags.githubUser || authorName
const { token, githubRepo } = cli.flags
const showGithubStats = cli.flags.github

async function getPullRequestIds () {
  const { body } = await ghGot(`repos/${githubRepo}/pulls?state=all`, { token })
  return body.map(({ number }) => number)
}

async function getReviews () {
  const pullRequestIds = await getPullRequestIds()
  const requests = pullRequestIds.map(id =>
    ghGot(`repos/${githubRepo}/pulls/${id}/reviews`, { token })
  )
  const responses = await Promise.all(requests)

  return responses.reduce((reviews, { body }) =>
    reviews.concat(body.filter(({ user }) => user.login === githubUser))
  , [])
}

function groupReviewsByStatus (reviews) {
  return reviews.reduce((counts, review) => {
    if (counts[review.state]) {
      counts[review.state]++
    } else {
      counts[review.state] = 1
    }
    return counts
  }, {})
}

async function printReport (commits) {
  const sortedCommits = commits.all.sort((a, b) => new Date(b.date) - new Date(a.date))
  const firstCommit = sortedCommits[0]
  const lastCommit = sortedCommits[sortedCommits.length - 1]
  const durationBetweenLimits = getDurationBetweenCommits(firstCommit, lastCommit)
  const changes = await totalChanges(commits.all.filter(({ message }) => message.indexOf('Merge') === -1))

  console.log(`Name: ${authorName}`)
  console.log(`Total commits: ${commits.all.length}`)
  console.log(`Duration: ${durationBetweenLimits}`)
  console.log(`Additions: ${chalk.green(changes.insertions)}`)
  console.log(`Deletions: ${chalk.red(changes.deletions)}`)

  if (showGithubStats && githubRepo && githubUser && token) {
    const reviews = await getReviews(authorName)
    const reviewGroups = groupReviewsByStatus(reviews)

    console.log(`Reviews: ${reviews.length}`)
    Object.keys(reviewGroups).forEach(key => {
      console.log(`Reviews (${key}): ${reviewGroups[key]}`)
    })
  }
}

function totalChanges (commits) {
  const promises = commits.map(commit =>
    git(cli.flags.dir).show(['--stat', commit.hash])
      .then(str => {
        const insertions = str.match(/([0-9]+) insertions?/)
        const deletions = str.match(/([0-9]+) deletions?/)

        return {
          insertions: insertions ? parseInt(insertions[1]) : 0,
          deletions: deletions ? parseInt(deletions[1]) : 0
        }
      })
  )

  return Promise.all(promises).then(commits =>
    commits.reduce((changes, commit) => {
      changes.insertions += commit.insertions
      changes.deletions += commit.deletions
      return changes
    }, { insertions: 0, deletions: 0 })
  )
}

function getDurationBetweenCommits (commitA, commitB) {
  const ms = differenceInMilliseconds(new Date(commitA.date), new Date(commitB.date))
  return prettyMs(ms)
}

git(cli.flags.dir).log({ '--author': authorName })
  .then(printReport)
  .catch(err => console.error(err))
