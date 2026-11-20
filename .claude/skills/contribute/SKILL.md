---
name: contribute
description: Complete one ready StudyNotes task from TASKS.md and deliver a draft PR or portable Git patch.
---

# Contribute one task

1. Use a fresh checkout of the public StudyNotes repository or your own fork.
   Keep another contributor's work out of this task. Read CLAUDE.md,
   AGENTS.md, and TASKS.md. Fetch vlmelnik/studynotes main as the base. Use
   a new branch named contrib/sn-001-<short-suffix> for SN-001, or the
   equivalent branch naming the environment supports.
2. Pick the first ready task for which there is no open PR. If the requester
   specified a task ID, work only on that task. Use your existing GitHub
   connection, the public PR list, or GitHub CLI to check titles for the
   exact prefix [SN-001] (substitute the task ID). Check again just before
   publishing. If you cannot check remotely, continue locally and disclose
   that conflict status is unverified.
3. Edit only the task's named paths. Use English and neutral examples. Keep
   private notes, test data, credentials and generated files out of the
   commit. Follow the verification listed in the task and AGENTS.md. Inspect
   the staged diff and run git diff --cached --check. Make one scoped commit
   with a subject beginning with the task ID in square brackets. Use a
   public-safe Git identity, or a neutral contributor identity if needed.
4. Write a short PR body with the change, checks and any limitations. Use
   an existing authorized GitHub connection. If working from a fork, push
   the contribution branch to that fork and target upstream main. If the
   connection already has write access to StudyNotes, push only the new
   contribution branch. Open a draft PR and return its URL.
5. If GitHub publication is unavailable, export the single commit to a file
   outside the checkout. Report the patch path and the verification results.
   Stop after one task. Leave approval, merge and task status to the maintainer.

With GitHub CLI, check your existing session with gh api user --jq .login.
For a fork, use gh repo fork vlmelnik/studynotes --remote=false if needed and
verify the actual fork belongs to that user and its parent is StudyNotes.
To reuse the existing CLI login for this one push, set PUSH_URL to the
verified HTTPS Git remote and use the command below. Then open the draft
with your actual login, branch,
title and a local PR description file:

~~~sh
git -c credential.helper= -c "credential.https://github.com.helper=!gh auth git-credential" push "$PUSH_URL" "HEAD:refs/heads/$BRANCH"
gh pr create --repo vlmelnik/studynotes --base main --head "$LOGIN:$BRANCH" --draft --title "$TITLE" --body-file "$BODY_FILE"
~~~

Use the following command to export one commit. Check that the indicated
file exists and report it outside the checkout:

~~~sh
git format-patch -1 HEAD --output-directory "$PATCH_DIR"
~~~
