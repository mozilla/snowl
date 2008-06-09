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
document.getElementById("timestamp").value = message.timestamp;

let link = document.createElementNS(HTML_NS, "a");
link.setAttribute("href", message.link);
link.appendChild(document.createTextNode(message.link));
document.getElementById("link").appendChild(link);
