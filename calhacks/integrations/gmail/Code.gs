/**
 * Back of House: send the restaurant's new Gmail to the app's email inbox.
 *
 * Runs inside the restaurant's own Gmail account (Google Apps Script). Every minute (or right away,
 * from "Check email now" in the app) it finds emails it hasn't sent yet and posts each one, with its attachments, to
 * /api/inbound/email in the same JSON shape Postmark uses. The app then reads supplier
 * invoices and customer orders exactly as it does for Postmark.
 *
 * Setup (see README.md): paste this file into a new project at script.google.com, add the
 * script property WEBHOOK_URL, then run setup() once and allow access.
 */

// Vercel rejects requests over about 4.5 MB, and base64 makes files a third bigger
var MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
var START = 'START_MS'; // only mail from this time on is sent (older mail is left alone)
var SENT = 'SENT_IDS'; // Gmail ids already sent, newest last, so a late-arriving email is still sent once
var OLD_LAST_CHECK = 'LAST_CHECK_MS'; // from the first version of this script
var KEEP_IDS = 300;

/** Run once: starts the every-minute check, from now on (older mail is left alone). */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('WEBHOOK_URL')) throw new Error('Add the script property WEBHOOK_URL first (Project Settings > Script Properties).');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkInbox') ScriptApp.deleteTrigger(t);
  });
  props.setProperty(START, String(Date.now()));
  props.setProperty(SENT, '[]');
  ScriptApp.newTrigger('checkInbox').timeBased().everyMinutes(1).create();
  Logger.log('Checking the inbox every minute from now on.');
}

/** Run to send the last hour's mail again (the app skips anything it already saved). */
function resendLastHour() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(START, String(Date.now() - 60 * 60 * 1000));
  props.setProperty(SENT, '[]');
  Logger.log('Sent ' + (checkInbox() || 0) + ' email(s) to Back of House.');
}

/**
 * "Check email now" in the app: deployed as a web app (Deploy > New deployment > Web app),
 * the app calls this to check right away instead of waiting up to a minute for the timer.
 * It only answers with the same secret the app uses (the token in WEBHOOK_URL).
 */
function doGet(e) {
  var url = PropertiesService.getScriptProperties().getProperty('WEBHOOK_URL') || '';
  var secret = (/[?&]token=([^&]+)/.exec(url) || [])[1];
  var json = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  if (!secret || !e || !e.parameter || e.parameter.token !== decodeURIComponent(secret)) return json({ ok: false, error: 'Not allowed.' });
  var sent = checkInbox();
  return json({ ok: true, sent: sent === null ? 0 : sent, busy: sent === null });
}

/** Run to stop sending mail to the app. */
function stop() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkInbox') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Stopped.');
}

/** Sends new mail to the app. Returns how many emails it sent, or null if a run is already going. */
function checkInbox() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBHOOK_URL');
  if (!url) return 0;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return null; // the timer's run is still going (it's sending the mail anyway)
  try {
    // Older setups only stored the last check time: start from there
    if (!props.getProperty(START)) props.setProperty(START, props.getProperty(OLD_LAST_CHECK) || String(Date.now()));
    var start = Number(props.getProperty(START));
    var done = JSON.parse(props.getProperty(SENT) || '[]');
    var seen = {};
    done.forEach(function (id) { seen[id] = true; });
    var me = Session.getEffectiveUser().getEmail().toLowerCase();
    // Look back two days every time, not just since the last check: mail from another provider can
    // land in Gmail minutes after the time it says it was sent. Ids already sent are skipped.
    var after = Math.max(Math.floor((start - 60000) / 1000), Math.floor(Date.now() / 1000) - 2 * 24 * 3600);
    var threads = GmailApp.search('in:inbox after:' + after, 0, 50);
    var sent = 0;
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        var id = m.getId();
        if (seen[id] || m.getDate().getTime() < start) return;
        var from = parseFrom(m.getFrom());
        if (from.email === me) { seen[id] = true; done.push(id); return; } // the owner's own replies
        var res = UrlFetchApp.fetch(url, {
          method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          payload: JSON.stringify(toPostmark(m, from)),
        });
        if (res.getResponseCode() === 200) {
          seen[id] = true;
          done.push(id);
          sent++;
        } else {
          // Not marked as sent, so it's tried again next minute (the app saves each email once)
          Logger.log('The app answered ' + res.getResponseCode() + ' for "' + m.getSubject() + '": ' + res.getContentText().slice(0, 200));
        }
      });
    });
    props.setProperty(SENT, JSON.stringify(done.slice(-KEEP_IDS)));
    if (sent) Logger.log('Sent ' + sent + ' email(s) to Back of House.');
    return sent;
  } finally {
    lock.releaseLock();
  }
}

function parseFrom(raw) {
  var m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw || '');
  return m ? { name: m[1].trim(), email: m[2].trim().toLowerCase() } : { name: '', email: String(raw || '').trim().toLowerCase() };
}

// The JSON Postmark's inbound webhook sends, which the app already reads (lib/email/parse.ts)
function toPostmark(m, from) {
  var attachments = m.getAttachments({ includeInlineImages: false })
    .filter(function (a) { return a.getSize() <= MAX_ATTACHMENT_BYTES; })
    .map(function (a) {
      return { Name: a.getName(), ContentType: a.getContentType(), ContentLength: a.getSize(), Content: Utilities.base64Encode(a.getBytes()) };
    });
  var headers = ['Auto-Submitted', 'Precedence'].map(function (n) { return { Name: n, Value: m.getHeader(n) || '' }; });
  return {
    MessageID: m.getHeader('Message-ID') || m.getId(),
    From: m.getFrom(),
    FromFull: { Email: from.email, Name: from.name },
    Subject: m.getSubject(),
    TextBody: m.getPlainBody(),
    HtmlBody: m.getPlainBody() ? '' : m.getBody(), // only when there's no plain text, to stay small
    Headers: headers,
    Attachments: attachments,
  };
}
