/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Snowl.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Myk Melez <myk@mozilla.org>
 *   alta88 <alta88@gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/utils.js");

const XML_NS = "http://www.w3.org/XML/1998/namespace"
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";

let gBrowserWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIWebNavigation).
                     QueryInterface(Ci.nsIDocShellTreeItem).
                     rootTreeItem.
                     QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIDOMWindow);

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

let stringBundle = document.getElementById("snowlStringBundle");

let message = SnowlMessage.get(parseInt(params.id));

let body = document.getElementById("body");

let content = message.content || message.summary || message.notfound;

if (content) {
  if (content.text != "notfound") {

    if (content.base)
      body.setAttributeNS(XML_NS, "base", content.base.spec);

    // Brief headers
    document.getElementById("briefAuthor").value = message.author;
    document.getElementById("briefSubject").value = message.subject;
    document.getElementById("briefSubject").setAttribute("href", message.link);
    document.getElementById("briefTimestamp").value = SnowlDateUtils._formatDate(message.timestamp);
    
    // Full headers
    document.getElementById("author").value = message.author;
    document.getElementById("subject").value = message.subject;
    document.documentElement.setAttribute("title", message.subject);
    document.getElementById("timestamp").value = SnowlDateUtils._formatDate(message.timestamp);
    document.getElementById("link").href = message.link;
    document.getElementById("link").value = message.link;
  
    gBrowserWindow.Snowl._toggleHeader("TabSelect");
  }
  else {
    // No message found
    let notFound = stringBundle.getFormattedString("messageNotFound", [params.id]);
    content.text = "<p><strong>" + notFound + "</strong></p>";
    document.documentElement.setAttribute("title",
        stringBundle.getFormattedString("messageNotFoundTitle", [params.id]));

    gBrowserWindow.Snowl._toggleHeader(gBrowserWindow.Snowl.kNoHeader);
  }

  let docFragment = content.createDocumentFragment(body);
  if (docFragment)
    body.appendChild(docFragment);
}
