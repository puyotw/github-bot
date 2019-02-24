module.exports = app => {

  // when a PR is closed, delete the preview site from preview-site
  app.on('pull_request.closed', async context => {
    if (context.payload.repository.full_name != 'puyotw/core-site') return;

    const prNumber = context.payload.number;
    context.log.info('PR #' + prNumber + ' was closed.');

    // this is different from context.github which is instance of core-site.
    removePreview(await getHub(app, 'preview-site'), prNumber);
  });

  // when a commit is pushed to preview-site, there may be a new preview site generated,
  // in that case, comment the link on the PR that generated the preview site
  app.on('push', async context => {
    if (context.payload.repository.full_name != 'puyotw/preview-site') return;

    let head = context.payload.commits.shift();
    let match; if (null == (match = head.message.match(/\(#([0-9]+)\)/)))
    {
      context.log.info('A new commit was pushed to preview-site,', 
                       'but commit message does not contain a PR number:\n' + head.message);
      context.log.info('Maybe this is not a preview-generating commit?');
      return;
    }

    // we found the PR number from commit message,
    // post the url to the PR now
    let prNumber = +match.pop();
    context.log.info('Preview site for PR #' + prNumber + ' has been generated.');
    
    let github = await getHub(app, 'core-site');

    github.pullRequests.createReview({
      owner  : 'puyotw',
      repo   : 'core-site',
      number : prNumber,
      event  : 'COMMENT',
      body   : '成功生成預覽站！請前往 https://preview.puyo.tw/' + prNumber + ' 以預覽最新變動。',
    });
    
  });
}


/**
 * Convenience function to fetch the specific GitHub instance.
 */
async function getHub(app, repo) {
  let appHub = await app.auth();
  let { data: installation } = await appHub.apps.findRepoInstallation({ owner: 'puyotw', repo: repo })
  let repoHub = await app.auth(installation.id);
  repoHub.log = app.log;
  return repoHub;
}

async function removePreview(hub, prNumber) {
  // populate some information needed in all API calls
  function supplement(obj) {
    obj.owner = 'puyotw';
    obj.repo  = 'preview-site';
    return obj;
  }

  // get master head commit info
  const master = await hub.repos.getBranch(supplement({
    branch : 'master'
  }));

  // get git tree of master head
  let tree = await hub.gitdata.getTree(supplement({
    tree_sha : master.data.commit.commit.tree.sha
  }));

  // create new tree with the whole tree(subdirectory) named `prNumber` removed
  let newTree = await hub.gitdata.createTree(supplement({
    tree : tree.data.tree.filter(elm => elm.type != 'tree' || elm.path != prNumber)
  }));

  // create commit that removes the preview site
  let newCommit = await hub.gitdata.createCommit(supplement({
    tree    : newTree.data.sha,
    parents : [ master.data.commit.sha ],
    message : 'Removing preview ' + prNumber + ' due to the closing of PR.'
  }));

  hub.log.info('New commit ' + newCommit.data.sha + ' created.');

  // set commit as head of master
  await hub.gitdata.updateRef(supplement({
    ref : 'heads/master',
    sha : newCommit.data.sha
  }));

  hub.log.info('Commit has been set as head of master.');
}
