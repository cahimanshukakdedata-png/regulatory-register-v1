# Deployment, step by step

Do this on a laptop or desktop. GitHub's phone view hides some of the buttons.
It takes about 15 minutes, once. After that the register updates on its own.

---

## Step 1. Unzip and look inside

Unzip the download. Open the `regulatory-register` folder so that you can see
these items **directly** in the window:

```
.github            (may be hidden on your computer)
data
scraper
index.html
README.md
SETUP.md
package.json
package-lock.json
workflow-file.txt
```

These are the files you will upload. Do **not** upload the folder itself.

**Windows:** if you cannot see `.github`, open the View menu in File Explorer
and tick **Hidden items**.

---

## Step 2. Create a GitHub account

Go to github.com and sign up, if you do not already have an account. It is free.

---

## Step 3. Create the repository

1. Click the **+** at the top right, then **New repository**.
2. Repository name: `regulatory-register` (check the spelling).
3. Choose **Public**. Public keeps the hosting free. The page holds only public
   information. Your read marks, stars and own entries stay in your browser.
4. Do not tick "Add a README file".
5. Click **Create repository**.

---

## Step 4. Upload the files

1. On the new repository page, click the link **uploading an existing file**.
2. In the folder from step 1, press **Ctrl+A** to select everything inside it,
   then drag the selection onto the GitHub page.
3. Wait for the file names to finish listing, then click **Commit changes**.
4. Click the **Code** tab and check what is there:
   - You should see `data`, `scraper`, `index.html` and the rest **directly**.
   - If instead you see one folder named `regulatory-register`, you uploaded the
     folder rather than its contents. Delete the repository
     (Settings → General → bottom of the page) and repeat steps 3 and 4.
   - If `.github` is missing from the list, do step 5. Otherwise skip it.

---

## Step 5. Only if `.github` is missing

Computers often skip folders whose name starts with a dot. Create the file by
hand instead:

1. **Code** tab → **Add file** → **Create new file**.
2. In the name box type exactly: `.github/workflows/update.yml`
   Each `/` you type creates a folder. That is expected.
3. Open `workflow-file.txt` from the unzipped folder in Notepad, select all,
   copy, and paste it into the large box on GitHub.
4. Click **Commit changes**, then confirm.

---

## Step 6. Turn on the website

1. Go to the **Settings** tab of the repository.
2. Click **Pages** in the left menu.
3. Under *Build and deployment*, set **Source** to **GitHub Actions**.
4. Ignore the two suggested workflow boxes ("GitHub Pages Jekyll" and
   "Static HTML"). Do not click Configure on either. Your own workflow does the job.

---

## Step 7. Run the collector once

1. Go to the **Actions** tab.
2. If a message asks, click **I understand my workflows, go ahead and enable them**.
3. In the left list, click **Collect updates**.
4. On the right, click the **Run workflow** button, then the green
   **Run workflow** inside the small box that opens.
5. Refresh the page. A new line appears with a yellow dot, meaning it is running.
   It takes 3 to 5 minutes and ends with a green tick.

If "Collect updates" is not in the left list, the workflow file is missing: do step 5.

---

## Step 8. Open your register

1. Go to **Settings → Pages**. It now shows *Your site is live at* with a link,
   in the form `https://YOUR-USERNAME.github.io/regulatory-register/`
2. Open it and bookmark it on your laptop and phone.
3. Open the **Sources** tab on the page to see which websites worked.

---

## Step 9. Run it a second time

Government websites have no feeds, so on the first run the collector only records
the links already on each page. From the second run onward it reports the links
that are new. Either click **Run workflow** again after a few minutes, or simply
wait for the next scheduled run.

---

## After this

The collector runs by itself at about 7 am, 11 am, 3 pm and 8 pm IST.

- Open your bookmark, or press **Refresh** on the page, to load the latest collection.
  A tab left open overnight keeps showing the old data until you refresh it.
- **Collect now** on the page starts an extra run between the scheduled ones.
- If GitHub emails you that scheduled runs were disabled for inactivity, open the
  **Actions** tab and click **Enable workflow**.

---

## If a run shows a red cross

Click the failed run, then the red step, and read the message.

| Message mentions | What to do |
|---|---|
| `github-pages`, environment, or Pages | Step 6 was not done. Do it, then open the run and click **Re-run all jobs**. |
| Permission denied, or 403, at the "Save collected data" step | Settings → Actions → General → **Workflow permissions** → **Read and write permissions** → Save. Then re-run. |
| `npm ci`, lock file, or package.json at the "Install" step | `package.json` or `package-lock.json` did not upload. Upload both, then re-run. |
| Every source failed at the "Collect" step | Usually a temporary network problem at GitHub's end. Run it again later. |

A single failing website never stops the others. The **Sources** tab on your page
shows what each one did on the last run.
