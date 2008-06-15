const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/message.js");

const XML_NS = "http://www.w3.org/XML/1998/namespace"
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";

// Parse URL parameters
let params = {};
let query = window.location.search.substr(1);
for each (let param in query.split("&")) {
  let name, value;
  if (param.indexOf("=") != -1) {
    [name, value] = param.split("=");
    value = decodeURIComponent(value);
  }
  else
    name = param;
  params[name] = value;
}

let message = SnowlMessage.get(parseInt(params.id));

let body = document.getElementById("body");

let content = message.content || message.summary;
if (content) {
  if (content.base)
    body.setAttributeNS(XML_NS, "base", content.base.spec);

  let docFragment = content.createDocumentFragment(body);
  if (docFragment)
    body.appendChild(docFragment);
}

document.getElementById("author").value = message.author;
document.getElementById("subject").value = message.subject;
document.documentElement.setAttribute("title", message.subject);
document.getElementById("timestamp").value = formatTimestamp(new Date(message.timestamp));
document.getElementById("link").href = message.link;
document.getElementById("link").value = message.link;

// FIXME: put this into a SnowlUtils module.

/**
 * Formats a timestamp for human consumption using the date formatting service
 * for locale-specific formatting along with some additional smarts for more
 * human-readable representations of recent timestamps.
 * @param   {Date} the timestamp to format
 * @returns a human-readable string
 */
function formatTimestamp(aTimestamp) {
  let formattedString;

  let dfSvc = Cc["@mozilla.org/intl/scriptabledateformat;1"].
              getService(Ci.nsIScriptableDateFormat);

  let now = new Date();

  let yesterday = new Date(now - 24 * 60 * 60 * 1000);
  yesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

  let sixDaysAgo = new Date(now - 6 * 24 * 60 * 60 * 1000);
  sixDaysAgo = new Date(sixDaysAgo.getFullYear(), sixDaysAgo.getMonth(), sixDaysAgo.getDate());

  if (aTimestamp.toLocaleDateString() == now.toLocaleDateString())
    formattedString = dfSvc.FormatTime("",
                                             dfSvc.timeFormatNoSeconds,
                                             aTimestamp.getHours(),
                                             aTimestamp.getMinutes(),
                                             null);
  else if (aTimestamp > yesterday)
    formattedString = "Yesterday " + dfSvc.FormatTime("",
                                                            dfSvc.timeFormatNoSeconds,
                                                            aTimestamp.getHours(),
                                                            aTimestamp.getMinutes(),
                                                            null);
  else if (aTimestamp > sixDaysAgo)
    formattedString = dfSvc.FormatDateTime("",
                                                 dfSvc.dateFormatWeekday, 
                                                 dfSvc.timeFormatNoSeconds,
                                                 aTimestamp.getFullYear(),
                                                 aTimestamp.getMonth() + 1,
                                                 aTimestamp.getDate(),
                                                 aTimestamp.getHours(),
                                                 aTimestamp.getMinutes(),
                                                 aTimestamp.getSeconds());
  else
    formattedString = dfSvc.FormatDateTime("",
                                                 dfSvc.dateFormatShort, 
                                                 dfSvc.timeFormatNoSeconds,
                                                 aTimestamp.getFullYear(),
                                                 aTimestamp.getMonth() + 1,
                                                 aTimestamp.getDate(),
                                                 aTimestamp.getHours(),
                                                 aTimestamp.getMinutes(),
                                                 aTimestamp.getSeconds());

  return formattedString;
}
