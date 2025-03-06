'use strict';

import 'dotenv/config'
import { Octokit } from "octokit";
import pkg from '@slack/bolt';
import { ReposAndLabels } from './otel.js';
const { App, ExpressReceiver } = pkg;

const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET });

const app = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token: process.env.SLACK_BOT_TOKEN,
    receiver,
});

// import { App } from "octokit";
// const app = new App({
//   appId: APP_ID,
//   privateKey: PRIVATE_KEY,
// });
// const octokit = await app.getInstallationOctokit(INSTALLATION_ID);
const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN
});

(async () => {
    await app.start(process.env.PORT || 6000);
    console.log('Otel Finder is running!');
})();

app.command('/otel-finder', async ({
  command,
  ack
}) => {
  if (command.text == "help") {
    ack();
    help(command);
    return;
  }
  await ack("Retrieving issues");
  postHeaderMessage(command);

  const repos = getReposToSearch(command);  
  Object.keys(repos).forEach(repo => {
    let issues = {}
    new Promise(async resolve => {
      const repoIssues = await octokit.rest.search.issuesAndPullRequests({
          q: `repo:open-telemetry/${repo} is:issue state:open no:assignee label:${repos[repo]}`
      })
      let list = []
      repoIssues.data.items.forEach(issue => {
          if (list.length >= 30) {
              return;
          }
          list.push({
              url: issue.html_url,
              title: issue.title,
              created_at: issue.created_at,
              interactions: issue.comments + issue.reactions?.total_count
          })
      })
      issues[repo] = list;
      resolve(issues);
    }).then(issues => {
      var blocks = [];

      Object.keys(issues).sort().forEach(repo => {
        blocks = []
        blocks.push({"type": "header", "text": {"type": "plain_text", "text": `:opentelemetry: ${repo} :opentelemetry:`}})
        issues[repo].forEach(issue => {
          blocks.push({"type": "markdown", "text": formatIssueAsMarkdown(issue)});
        })
        if (issues[repo].length == 0) {
          blocks.push({"type": "markdown", "text": `_No issues found for this repo_`});
        }
        blocks.push({"type": "divider"});

        app.client.chat.postMessage({
          token: process.env.SLACK_BOT_TOKEN,
          channel: command.channel_id,
          text: `List of issues found for ${repo}`,
          blocks: blocks
        });
      })
    })
  })
});

const help = (command) => {
  app.client.chat.postEphemeral({
    token: process.env.SLACK_BOT_TOKEN,
    channel: command.channel_id,
    user: command.user_id,
    text: `List issues that are \`good first issue\` or have a similar label, and are not already assigned.
  - No arguments: List issues for all OpenTelemetry repositories
  - With arguments (repos separated by comma): List issues for the listed repositories, e.g. \`/otel-finder opentelemetry-js,opentelemetry-java\``
  });
}

const postHeaderMessage = (command) => {
  app.client.chat.postMessage({
    token: process.env.SLACK_BOT_TOKEN,
    channel: command.channel_id,
    text: '',
    blocks: [
      {
			"type": "header",
			"text": {
				"type": "plain_text",
				"text": ":opentelemetry-spin: OpenTelemetry Issues :opentelemetry-spin:"
			}
		},
		{
			"type": "context",
			"elements": [
				{
					"type": "mrkdwn",
					"text": "Hello there! This is a list of OpenTelemetry issues not yet assigned marked as `good first issue` grouped by repositories."
				}
			]
		},]
  });
}

const getReposToSearch = (command) => {
  if (command.text == "") {
    return ReposAndLabels;
  } 
  const reposList = command.text.split(",");
  const filteredRepos = {};
  reposList.forEach(r => {
    if (Object.keys(ReposAndLabels).includes(r.trim())) {
      filteredRepos[r] = ReposAndLabels[r];
    } else {
      app.client.chat.postEphemeral({
        token: process.env.SLACK_BOT_TOKEN,
        channel: command.channel_id,
        user: command.user_id,
        text: `This application doesn't have a \`good first issue\` label associated for the repo ${r}`
      });
    }
  })
  return filteredRepos;
}

const formatIssueAsMarkdown = (issue) => {
  const date = new Date(issue.created_at);
  const creation = `${date.toLocaleString('default', { month: 'long' })} ${date.getDate()}, ${date.getFullYear()}`;
  return `- [${issue.title}](${issue.url}) 
    Created: ${creation} ${getNewIssueEmoji(issue)}
    Interactions: ${issue.interactions} ${getInteractionsEmoji(issue)}`;
}

const getNewIssueEmoji = (issue) => {
  const date = new Date(issue.created_at);
  var targetDate= new Date();
  targetDate.setDate(new Date().getDate() - 30);
  if (date > targetDate) {
    return ':new-issue:';
  }
  return '';
}

const getInteractionsEmoji = (issue) => {
  if (issue.interactions >= 50) {
    return ':thisisfine:';
  }
  if (issue.interactions >= 15) {
    return ':fire::fire:';
  }
  if (issue.interactions >= 5) {
    return ':fire:';
  }
  return '';
}

export const slack = receiver.app;