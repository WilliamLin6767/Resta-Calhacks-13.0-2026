# Gmail to Back of House

A small Google Apps Script that runs inside the restaurant's own Gmail account. Every minute it
sends new emails, with their attachments, to the app's email inbox (`/api/inbound/email`). Supplier
invoices are then read on their own, and customer orders wait on the Invoices page for the owner
to confirm. You don't need Postmark, a Google Cloud project or Google's app review: the owner
approves the script once, in their own account.

## Set up (about 5 minutes)

1. **Vercel:** add `INBOUND_EMAIL_SECRET` (a long random value, the same one as in `.env.local`) and
   `INBOUND_EMAIL_ADDRESS` (the restaurant's Gmail address) under Production, then redeploy.
2. Sign in to the restaurant's Gmail, then open https://script.google.com and click **New project**.
   Name it "Back of House".
3. Delete the starter code, paste in all of [`Code.gs`](Code.gs), and save.
4. Click **Project Settings** (the gear), then **Script Properties → Add script property**:
   - Property: `WEBHOOK_URL`
   - Value: `https://resta-calhacks.vercel.app/api/inbound/email?token=` followed by the secret

   Then **Save script properties**.
5. Back in **Editor**, pick `setup` in the function menu at the top, then click **Run**.
6. Google asks for permission. Choose the restaurant's account. If it says "Google hasn't verified this
   app", click **Advanced**, then **Go to Back of House (unsafe)**. It's your own script, so this is
   expected. Then click **Allow**.
7. The log says "Checking the inbox every minute from now on." Done.

## "Check email now" (optional, for demos)

The timer checks once a minute. To check on demand from the app's Email inbox:

1. In the script editor, click **Deploy → New deployment**, then the gear next to "Select type", then **Web app**.
2. Execute as **Me**, Who has access **Anyone**, then **Deploy**. Allow access if asked, and copy the **Web app URL**
   (it ends in `/exec`).
3. **Vercel:** add `GMAIL_CHECK_URL` (that URL) under Production, then redeploy.

A **Check email now** button then shows in the Email inbox. It only works with the same secret as the webhook, so
someone who finds the URL can't use it. After changing `Code.gs` later, use **Deploy → Manage deployments → Edit →
Version: New version** so the web app runs the new code.

## Sending emails the owner approved (payout claims)

On the Accounting tab, a payout problem drafts an email to DoorDash or Uber Eats support. With the web app set up
(the three steps above), **Approve and send** sends it from the restaurant's Gmail, and it shows in Gmail's Sent folder.
Without it, the button opens the email in the owner's own mail app instead.

1. Use a `Code.gs` that has `doPost` (this one does), then **Deploy → Manage deployments → Edit → Version: New
   version → Deploy**. The URL stays the same, so `GMAIL_CHECK_URL` doesn't change.
2. If Google asks to allow access again, allow it the same way as in step 6 of the setup.
3. Optional, **Vercel:** `PAYOUT_SUPPORT_EMAIL_DOORDASH` and `PAYOUT_SUPPORT_EMAIL_UBEREATS` fill in the To box.
   For a demo, use your own or a teammate's address, not the apps' real support addresses.

It sends one plain-text email to one address, and only with the same secret as the webhook. Gmail limits a script to
about 100 emails a day on a regular account. If sending fails, the app shows Gmail's reason, and each try is under
**Executions**.

## Try it

From another email account, send the restaurant's Gmail something like "2 Pho Ga for pickup at 7pm
tomorrow". Within about a minute it shows in **Email inbox** on the Invoices page, waiting to be
confirmed.

## Good to know

- Only mail that arrives after `setup` is sent. The emails already in the inbox are left alone.
- The owner's own sent replies are skipped. A forwarded email arrives as "from the owner", so the app
  treats it as an unknown sender and waits for the owner to check it. Suppliers emailing the Gmail
  address directly are recognised from their address.
- Attachments over 3 MB are left out, because the app's host rejects bigger requests.
- To stop it, run `stop`. Each run's log is under **Executions**.
- If emails were missed (for example the app answered 401 because the secret didn't match), fix the
  cause and run `resendLastHour`. The app skips any email it already saved.
- "The app answered 401" means the secret in `WEBHOOK_URL` doesn't match `INBOUND_EMAIL_SECRET` on
  Vercel. Paste the same value in both, and redeploy after changing Vercel.
