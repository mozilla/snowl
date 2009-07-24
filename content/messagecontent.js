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

var gBrowserWindow = SnowlService.gBrowserWindow;

var strings = new StringBundle("chrome://snowl/locale/message.properties");

//****************************************************************************//
// Create headers and content.

var messageContent = {
  id: null,
  title: null,
  message: null,

  _attributes: null,
  get attributes() {
    if (this._attributes)
      return this._attributes;

    return this._attributes = this.message.attributes;
  },

  init: function() {
    // When message.xhtml is loaded on new message selection, onload handlers in
    // the messageHeader.xhtml and messageBody.xhtml frames run independently,
    // and before its own onload handler.  So we must have init() as inline script
    // to run first and set up the message.
    this.getMessageId();
    this.message = SnowlMessage.retrieve(this.id);
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
    var headerDeck = document.getElementById("headerDeck");

    if (!id)
      // Not in a message.
      return;

    if (message) {
      // Brief headers
      var subjectLink = document.getElementById("subject");
      subjectLink.appendChild(document.createTextNode(message.subject));
      if (message.link) {
        SnowlUtils.safelySetURIAttribute(subjectLink,
                                         "href",
                                         message.link.spec,
                                         message.source.principal);
        subjectLink.target = "messageBody";
      }

      if (message.author.person)
        document.getElementById("briefAuthor").
                 setAttribute("value", message.author.person.name);
      document.getElementById("briefTimestamp").
               appendChild(document.createTextNode(SnowlDateUtils._formatDate(message.timestamp)));

      // Basic headers
      if (message.author.person)
        document.getElementById("author").
                 appendChild(document.createTextNode(message.author.person.name));
      document.getElementById("timestamp").
               appendChild(document.createTextNode(SnowlDateUtils._formatDate(message.timestamp)));

      headerDeck.removeAttribute("notfound");

      if (message.current == MESSAGE_NON_CURRENT_DELETED ||
          message.current == MESSAGE_CURRENT_DELETED)
        headerDeck.setAttribute("deleted", true);
    }
    else {
      // Message no longer exists (removed source/author/message) but is in history.
      headerDeck.setAttribute("notfound", true);
    }
  },

  createFullHeader: function(headerDeck) {
//window.SnowlUtils._log.info("createHeader: attributes - "+this.attributes.toSource());
    // Iterate through message attributes object and create full header.
    var name, value, headerRow, headerRowLabel, headerRowData;
    var fullHeaderTable = headerDeck.parentNode.getElementsByClassName("fullHeaderTable")[0];
    if (fullHeaderTable.className != "fullHeaderTable")
      return;

    for ([name, value] in Iterator(this.attributes)) {
      headerRow = document.createElementNS(HTML_NS, "tr");
      headerRow.className = "fullHeaderRow";
      headerRowLabel = document.createElementNS(HTML_NS, "td");
      headerRowLabel.className = "headerLabel " + name;
      headerRowLabel.textContent = name + ":";
      headerRow.appendChild(headerRowLabel);
      headerRowData = document.createElementNS(HTML_NS, "td");
      headerRowData.className = "headerData " + name;
      headerRowData.textContent = value;
      headerRow.appendChild(headerRowData);
      fullHeaderTable.appendChild(headerRow);
    }
  },

  createBody: function(aType) {
    // The message is found in the scope of the parent frameset document.
    var messageContent = parent.wrappedJSObject.messageContent;
    var id = messageContent.id;
    var message = messageContent.message;
    var content;

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

      // Highlight search text, if any.
      content.text = messageHeaderUtils.highlight(content.text);

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
  ROWS_BRIEF: "28,*",

  init: function() {
    var pin = document.getElementById("pinButton");
    var headerBcaster = gBrowserWindow.document.getElementById("viewSnowlHeader");
    var headerDeck = document.getElementById("headerDeck");
    var noHeader = parent.document.documentElement.getElementsByClassName("noHeader")[0];
    var checked = headerBcaster.getAttribute("checked") == "true";
    pin.checked = checked;

    if (headerDeck.hasAttribute("notfound"))
      return;

    if (checked) {
      // Collapse hover area, set header.
      noHeader.setAttribute("collapsed", true);
      this.toggleHeader(headerDeck, "init");
    }
    else {
      // Uncollapse hover area, hide header frame.
      parent.document.body.setAttribute("border", "0");
      parent.document.body.rows = "0,*";
      noHeader.removeAttribute("collapsed");
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
                       }, 500);
  },

  onMouseOut: function(aEvent) {
    window.clearTimeout(this.headertimer);
    delete this.headertimer;
    var node = aEvent.target;
    var messageHeader = document.getElementById("messageHeader");
    var pin = messageHeader.contentDocument.getElementById("pinButton");
    if (node.id != "messageHeader" || pin.hasAttribute("checked"))
      return;

    document.getElementById("messageFrame").setAttribute("border", "0");
    document.getElementById("messageFrame").setAttribute("rows", "0,*");
    document.getElementById("noHeader").removeAttribute("collapsed");
  },

  onButtonKeyPress: function(aEvent) {
    if (aEvent.keyCode == KeyEvent.DOM_VK_RETURN ||
        aEvent.keyCode == KeyEvent.DOM_VK_TAB)
      return;

    // Remove focus from tabbable buttons for back/forward.
    // XXX: due to the button binding, an arrow key while the header button is
    // focused will throw once; no event cancelling functions cancel the event.
    aEvent.target.blur();
//    window = aEvent.target.ownerDocument.defaultView.gBrowserWindow;
  },

  togglePin: function(aEvent) {
    var pin = aEvent.target;
    var headerBcaster = gBrowserWindow.document.getElementById("viewSnowlHeader");
    headerBcaster.setAttribute("checked", pin.checked);
  },

  toggleHeader: function(headerDeck, aType) {
    var headerBcaster = gBrowserWindow.document.getElementById("viewSnowlHeader");
    var headerIndex = parseInt(headerBcaster.getAttribute("headerIndex"));
    var rowsBasic = headerBcaster.getAttribute("rowsBasic");
    var rowsFull = headerBcaster.getAttribute("rowsFull");

    if (aType != "init" && headerBcaster.getAttribute("checked") == "true") {
      // To set a header height: must first be in non Brief header, pin must be
      // checked, height can be dnd adjusted as desired, then header must be
      // toggled to save the height.
      if (headerIndex == 1)
        headerBcaster.setAttribute("rowsBasic", parent.document.body.rows);
      if (headerIndex == 2)
        headerBcaster.setAttribute("rowsFull", parent.document.body.rows);
    }

    if (aType == "toggle") {
      // Toggled to next in 3 way
      // XXX: set index to 1, as full header removed for now (createFullHeader
      // will not run, nor will button toggle to full).
      headerDeck = document.getElementById("headerDeck");
      headerIndex = ++headerIndex > 1 ? 0 : headerIndex++;
      headerBcaster.setAttribute("headerIndex", headerIndex);
    }

    headerDeck.setAttribute("header", headerIndex == 0 ? "brief" :
                                      headerIndex == 1 ? "basic" : "full");
    parent.document.body.setAttribute("border", "6");
    parent.document.body.rows = headerIndex == 0 ? this.ROWS_BRIEF :
                                headerIndex == 1 ? rowsBasic : rowsFull;

    // The message is found in the scope of the parent frameset document.
    var messageContent = parent.wrappedJSObject.messageContent;
    if (headerIndex == 2 && !messageContent._attributes)
      messageContent.createFullHeader(headerDeck);
  },

  onDeleteMessageButton: function() {
    // Delete button.
    var messageContent = parent.wrappedJSObject.messageContent;
    gBrowserWindow.SnowlMessageView.onDeleteMessage([messageContent.message])
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
      // Remove focus (for header button, arrow key binding issue).
      aEvent.target.blur();
    }
  },

  // Highlight given phrase, skipping html tags & entities.
  highlight: function(aContent) {
    var termsArray = [], hlindex = 0;
    var sidebarWin = gBrowserWindow.document.
                                    getElementById("sidebar").contentWindow;
    var collectionsView = sidebarWin.CollectionsView;

    if (!collectionsView)
      return aContent;

    var searchMsgs = collectionsView._searchFilter.getAttribute("messages") == "true";
    var searchTerms = collectionsView.Filters["searchterms"];

    if (!searchTerms || !searchMsgs)
      return aContent;

    // Remove negations (quoted strings and words), OR |, wildcard *.
    searchTerms = searchTerms.replace(/-[^".]*\s|-"[^".]*"|[\|\*]/g, "");
    // Make lower case for highlight array.
    // XXX: unicode? Bug 394604.  Result is that while sqlite may match the
    // record, unless the user input is exactly what is on the page, it won't show.
    searchTerms = searchTerms.toLowerCase();
    // Create | delimited string of strings and words sans quotes for highligher.
    searchTerms = searchTerms.match("[^\\s\"']+|\"[^\"]*\"|'[^']*'", "g").
                              join("|").
                              replace(/"/g, '');
    // Array to match term for hilight classname index.
    termsArray = searchTerms.split("|");

    var regexp = new RegExp("(<[\\s\\S]*?>|&.*?;)|(" + searchTerms + ")", "gi");
    return aContent.replace(regexp, function($0, $1, $2) {
      if ($2)
        hlindex = termsArray.indexOf($2.toLowerCase());
      return $1 || '<span class="hldefault hl' + hlindex +'">' + $2 + "</span>";
    });
  }

};
