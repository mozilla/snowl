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

// modules that are generic
Cu.import("resource://snowl/modules/StringBundle.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/utils.js");

let gBrowserWindow = SnowlService.gBrowserWindow;

let gNavigatorBundle = new StringBundle("chrome://browser/locale/browser.properties");
let strings = new StringBundle("chrome://snowl/locale/message.properties");

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

let content;

if (message) {
  // Brief headers
  document.getElementById("briefAuthor").value = message.authorName;
  document.getElementById("briefSubject").value = message.subject;
  document.getElementById("briefSubject").setAttribute("href", message.link);
  document.getElementById("briefTimestamp").value = SnowlDateUtils._formatDate(message.timestamp);

  // Full headers
  document.getElementById("author").value = message.authorName;
  document.getElementById("subject").value = message.subject;
  document.documentElement.setAttribute("title", message.subject);
  document.getElementById("timestamp").value = SnowlDateUtils._formatDate(message.timestamp);
  document.getElementById("link").href = message.link;
  document.getElementById("link").value = message.link;

  gBrowserWindow.Snowl._toggleHeader("TabSelect");

  content = message.content || message.summary;
}
else {
  // No message found with the given ID
  document.documentElement.setAttribute("title",
    strings.get("messageNotFoundTitle", [params.id]));

  gBrowserWindow.Snowl._toggleHeader(gBrowserWindow.Snowl.kNoHeader);

  content = Cc["@mozilla.org/feed-textconstruct;1"].
            createInstance(Ci.nsIFeedTextConstruct);
  let notFound = strings.get("messageNotFound", [params.id]);
  content.text = "<p><strong>" + notFound + "</strong></p>";
  content.type = "html";
  content.base = null;
  content.lang = null;
}

if (content) {
  let body = document.getElementById("body");

  if (content.type == "text") {
    SnowlUtils.linkifyText(content.text, body, message.source.principal);
  }
  else {
    // content.type == "html" or "xhtml"
    if (content.base)
      body.setAttributeNS(XML_NS, "base", content.base.spec);

    let docFragment = content.createDocumentFragment(body);
    if (docFragment)
      body.appendChild(docFragment);
  }
};

//****************************************************************************//
// Utils for headers.  Based on XULBrowserWindow in browser.js and SidebarUtils
// in sidebarUtils.js

var messageHeaderUtils = {
  handleLinkMouseMove: function MHU_handleLinkMouseMove(aEvent) {
    if (aEvent.target.localName != "label")
      return;

    var link = aEvent.target.href;
//    if (PlacesUtils.nodeIsURI(link))
      this.setOverLink(link, null);
//    else
//      this.clearURLFromStatusBar();
  },

  clearURLFromStatusBar: function MHU_clearURLFromStatusBar() {
    this.setOverLink("", null);
  },

  // Stored Status, Link and Loading values
  overLink: "",
  defaultStatus: gNavigatorBundle.get("nv_done"),
  statusText: "",

  get statusTextField() {
    delete this.statusTextField;
    return this.statusTextField = gBrowserWindow.
                                  document.getElementById("statusbar-display");
  },

  destroy: function() {
    // XXXjag to avoid leaks :-/, see bug 60729
    delete this.statusTextField;
    delete this.statusText;
  },

  setOverLink: function(link, b) {
    // Encode bidirectional formatting characters.
    // (RFC 3987 sections 3.2 and 4.1 paragraph 6)
    this.overLink = link.replace(/[\u200e\u200f\u202a\u202b\u202c\u202d\u202e]/g,
                                 encodeURIComponent);
    this.updateStatusField();
  },

  updateStatusField: function() {
    var text = this.overLink || this.defaultStatus;

    // check the current value so we don't trigger an attribute change
    // and cause needless (slow!) UI updates
    if (this.statusText != text) {
      this.statusTextField.label = text;
      this.statusText = text;
    }
  },

  copy: function(linkNode) {
    let link, clipboard;
    if (linkNode) {
      link = linkNode.getAttribute("value");
      clipboard = Cc["@mozilla.org/widget/clipboardhelper;1"].
                  getService(Ci.nsIClipboardHelper);
      clipboard.copyString(link);
    }
  },

  copyLink: function(linkNode) {
    let link, clipboard;
    if (linkNode) {
      link = linkNode.getAttribute("href");
      clipboard = Cc["@mozilla.org/widget/clipboardhelper;1"].
                  getService(Ci.nsIClipboardHelper);
      clipboard.copyString(link);
    }
  }

}
