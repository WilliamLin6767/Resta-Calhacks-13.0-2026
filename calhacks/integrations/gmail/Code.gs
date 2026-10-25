/**
 * Back of House: send the restaurant's new Gmail to the app's email inbox.
 *
 * Runs inside the restaurant's own Gmail account (Google Apps Script). Every minute it finds
 * emails that arrived since the last check and posts each one, with its attachments, to
 * /api/inbound/email in the same JSON shape Postmark uses. The app then reads supplier
 * invoices and customer orders exactly as it does for Postmark.
 *
 * Setup (see README.md): paste this file into a new project at script.google.com, add the
 * script property WEBHOOK_URL, then run setup() once and allow access.
 */

// Vercel rejects requests over about 4.5 MB, and base64 makes files a third bigger
var MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
var LAST_CHECK = 'LAST_CHECK_MS';

/** Run once: starts the every-minute check, from now on (older mail is left alone). */
function setup() {
  var url = PropertiesService.getScriptProperties().getProperty('WEBHOOK_URL');
  if (!url) throw new Error('Add the script property WEBHOOK_URL first (Project Settings > Script Properties).');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkInbox') ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().setProperty(LAST_CHECK, String(Date.now()));
  ScriptApp.newTrigger('checkInbox').timeBased().everyMinutes(1).create();
  Logger.log('Checking the inbox every minute from now on.');
}

/** Run to send the last hour's mail again (the app skips anything it already saved). */
function resendLastHour() {
  PropertiesService.getScriptProperties().setProperty(LAST_CHECK, String(Date.now() - 60 * 60 * 1000));
  checkInbox();
}

/** Run to stop sending mail to the app. */
function stop() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkInbox') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Stopped.');
}

function checkInbox() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBHOOK_URL');
  if (!url) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // the last run is still going
  try {
    var since = Number(props.getProperty(LAST_CHECK) || Date.now());
    var started = Date.now();
    var me = Session.getEffectiveUser().getEmail().toLowerCase();
    // Gmail search works in whole seconds; look a minute back and filter exactly below
    var threads = GmailApp.search('in:inbox after:' + Math.floor((since - 60000) / 1000), 0, 50);
    var sent = 0;
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        var at = m.getDate().getTime();
        if (at <= since || at > started) return;
        var from = parseFrom(m.getFrom());
        if (from.email === me) return; // the owner's own replies
        var res = UrlFetchApp.fetch(url, {
          method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          payload: JSON.stringify(toPostmark(m, from)),
        });
        sent++;
        if (res.getResponseCode() !== 200) Logger.log('The app answered ' + res.getResponseCode() + ' for "' + m.getSubject() + '": ' + res.getContentText().slice(0, 200));
      });
    });
    props.setProperty(LAST_CHECK, String(started));
    if (sent) Logger.log('Sent ' + sent + ' email(s) to Back of House.');
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
