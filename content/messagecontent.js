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
//const Cr = Components.results;
const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/StringBundle.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/utils.js");

var gBrowserWindow = SnowlService.gBrowserWindow;

var strings = new StringBundle("chrome://snowl/locale/message.properties");

//****************************************************************************//
// Create headers and content.

var messageContent = {
  id: null,
  title: null,
  message: null,

  init: function() {
    // When message.xhtml is loaded on new message selection, onload handlers in
    // the messageHeader.xhtml and messageBody.xhtml frames run independently,
    // and before its own onload handler.  So we must have init() as inline script
    // to run first and set up the message.
//window.SnowlUtils._log.info("init");
    this.getMessageId();
    this.message = SnowlMessage.get(this.id);
    this.createTitle();
  },

  getMessageId: function() {
    var params = {};
    var query = parent.location.search.substr(1);
    for each (var param in query.split("&")) {
      var name, value;
      if (param.indexOf("=") != -1) {
        [name, value] = param.split("=");
        value = decodeURIComponent(value);
      }
      else
        name = param;
      params[name] = value;
    }

    this.id = parseInt(params.id);
  },

  createTitle: function() {
    this.title = this.message ? this.message.subject :
                                strings.get("messageNotFoundTitle", [this.id]);
    top.document.title = this.title;
  },

  createHeader: function() {
    // The message is found in the scope of the parent frameset document.
    var messageContent = parent.wrappedJSObject.messageContent;
    var id = messageContent.id;
    var message = messageContent.message;

//window.SnowlUtils._log.info("createHeader: START - onInit: id - "+id);
    if (!id)
      // Not in a message.
      return;
//window.SnowlUtils._log.info("createHeader: CONTINUE");

    if (message) {
      // XXX: make headers construction dynamic based on passed array, or json
      // representation etc.

      // Brief headers
      document.getElementById("briefAuthor").
               setAttribute("value", message.authorName);
//               appendChild(document.createTextNode(message.authorName));
      document.getElementById("briefSubject").
               appendChild(document.createTextNode(message.subject));
      document.getElementById("briefSubject").href = message.link;
      document.getElementById("briefSubject").target = "messageBody";
      document.getElementById("briefTimestamp").
               appendChild(document.createTextNode(SnowlDateUtils._formatDate(message.timestamp)));
    
      // Full headers
      document.getElementById("author").
               appendChild(document.createTextNode(message.authorName));
      document.getElementById("subject").
               appendChild(document.createTextNode(message.subject));
      document.getElementById("timestamp").
               appendChild(document.createTextNode(SnowlDateUtils._formatDate(message.timestamp)));
      document.getElementById("link").href = message.link;
      document.getElementById("link").target = "messageBody";
      document.getElementById("link").
               appendChild(document.createTextNode(message.link));
    }
    else {
      // Message no longer exists (removed source/author/message) but is in history.
//window.SnowlUtils._log.info("createHeader: msg GONE");
      var headerDeck = document.getElementById("headerDeck");
      headerDeck.setAttribute("collapsed", true);
      return;
  }

   messageHeaderUtils.init();
  },

  createBody: function(aType) {
    // The message is found in the scope of the parent frameset document.
    var messageContent = parent.wrappedJSObject.messageContent;
    var id = messageContent.id;
    var message = messageContent.message;
    var content;

//window.SnowlUtils._log.info("createBody: START - onInit: id - "+id);

    if (message) {
      content = message.content || message.summary;
    }
    else {
      // Message no longer exists (removed source/author/message) but is in history.
      content = Cc["@mozilla.org/feed-textconstruct;1"].
                createInstance(Ci.nsIFeedTextConstruct);
      var notFound = strings.get("messageNotFound", [id]);
      content.text = "<p><strong>" + notFound + "</strong></p>";
      content.type = "html";
      content.base = null;
      content.lang = null;
    }

    if (content) {
      var contentBody = document.getElementById("contentBody");

      if (!contentBody)
        // If no contentBody element, we are going back in history to a new message
        // but which contains a linked page and not message content; just return.
        return;

      if (content.type == "text") {
        SnowlUtils.linkifyText(content.text,
                               contentBody,
                               message.source.principal);
      }
      else {
        // content.type == "html" or "xhtml"
        if (content.base)
          document.body.setAttributeNS(XML_NS, "base", content.base.spec);

        var docFragment = content.createDocumentFragment(contentBody);
        if (docFragment)
          contentBody.appendChild(docFragment);
      }
    }
  }

};

//****************************************************************************//
// Utils for headers.

var messageHeaderUtils = {
  init: function() {
    var pin = document.getElementById("pinButton");
    var headerBcaster = gBrowserWindow.document.getElementById("viewSnowlHeader");
    var headerDeck = document.getElementById("headerDeck");
    var noHeader = parent.document.documentElement.getElementsByClassName("noHeader")[0];
    var checked = headerBcaster.getAttribute("checked") == "true";
    pin.checked = checked;

    if (checked) {
      // Collapse hover area, show headerDeck.
      noHeader.setAttribute("collapsed", true);
      headerDeck.removeAttribute("collapsed");
      this.toggleHeader(headerDeck);
    }
    else {
      // Uncollapse hover area, collapse headerDeck to prevent tab stops when
      // frame rows = 0.
      parent.document.body.setAttribute("border", "0");
      parent.document.body.rows = "0,*";
      noHeader.removeAttribute("collapsed");
      headerDeck.setAttribute("collapsed", true);
    }
  },

  onMouseOver: function(aEvent) {
    var node = aEvent.target;
    var messageHeader = document.getElementById("messageHeader");
    var headerDeck = messageHeader.contentDocument.getElementById("headerDeck");
    var pin = messageHeader.contentDocument.getElementById("pinButton");
    if (node.id != "noHeader" || pin.hasAttribute("checked"))
      return;

    this.headertimer = window.setTimeout(function() {
                         messageHeaderUtils.toggleHeader(headerDeck);
                         document.getElementById("noHeader").
                                  setAttribute("collapsed", true);
                         headerDeck.removeAttribute("collapsed");
                       }, 500);
  },

  onMouseOut: function(aEvent) {
    window.clearTimeout(this.headertimer);
    delete this.headertimer;
//window.SnowlUtils._log.info("onMouseOut: START");
    var node = aEvent.target;
    var messageHeader = document.getElementById("messageHeader");
    var headerDeck = messageHeader.contentDocument.getElementById("headerDeck");
    var pin = messageHeader.contentDocument.getElementById("pinButton");
    if (node.id != "messageHeader" || pin.hasAttribute("checked"))
      return;

    document.getElementById("messageFrame").setAttribute("border", "0");
    document.getElementById("messageFrame").setAttribute("rows", "0,*");
    document.getElementById("noHeader").removeAttribute("collapsed");
    headerDeck.setAttribute("collapsed", true);
  },

  togglePin: function(aEvent) {
    var pin = aEvent.target;
    if (pin.id != "pinButton")
      return;

    var headerBcaster = gBrowserWindow.document.getElementById("viewSnowlHeader");
    headerBcaster.setAttribute("checked", pin.checked);
  },

  toggleHeader: function(headerDeck, aType) {
    var headerBcaster = gBrowserWindow.document.getElementById("viewSnowlHeader");
    var headerIndex = parseInt(headerBcaster.getAttribute("headerIndex"));

    if (aType == "toggle") {
      // Toggled to next in 3 way
      // XXX: customize header will be index 2..
      headerDeck = document.getElementById("headerDeck");
      headerIndex = ++headerIndex > 1 ? 0 : headerIndex++;
      headerBcaster.setAttribute("headerIndex", headerIndex);
    }

    headerDeck.setAttribute("header", headerIndex == 0 ? "brief" :
                                      headerIndex == 1 ? "full" : "custom");
    parent.document.body.setAttribute("border", "6");
    // XXX: store whatever rows the user wants..
    parent.document.body.rows = headerIndex == 0 ? "28,*" :
                                headerIndex == 1 ? "80,*" : "72,*";
  },

  tooltip: function(aEvent, aShow) {
    // Need to handle tooltips manually in xul-embedded-in-xhtml; tooltip element
    // cannot be in the xhtml document either.
    var tooltip = gBrowserWindow.document.getElementById("snowlXulInXhtmlTooltip");
    if (aShow == 'show') {
      this.tiptimer = window.setTimeout(function() {
                        tooltip.label = aEvent.target.tooltipText;
                        tooltip.openPopup(aEvent.target, "after_start", 0, 0, false, false);
                      }, 800);
    }
    else if (aShow == 'hide') {
      window.clearTimeout(this.tiptimer);
      delete this.tiptimer;
      tooltip.label = "";
      tooltip.hidePopup();
    }
  }

};
