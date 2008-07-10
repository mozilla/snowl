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
 * The Original Code is the Feed Subscribe Handler.
 *
 * The Initial Developer of the Original Code is Google Inc.
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Ben Goodger <beng@google.com>
 *   Asaf Romano <mano@mozilla.com>
 *   Myk Melez <myk@mozilla.org>
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

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/URI.js");

Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/collection.js");

const XML_NS = "http://www.w3.org/XML/1998/namespace"
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";

let RiverView = {
  get _log() {
    delete this._log;
    return this._log = Log4Moz.Service.getLogger("Snowl.River");
  },

  // Date Formatting Service
  get _dfSvc() {
    let dfSvc = Cc["@mozilla.org/intl/scriptabledateformat;1"].
                getService(Ci.nsIScriptableDateFormat);
    delete this._dfSvc;
    this._dfSvc = dfSvc;
    return this._dfSvc;
  },

  // Favicon Service
  get _faviconSvc() {
    let faviconSvc = Cc["@mozilla.org/browser/favicon-service;1"].
                     getService(Ci.nsIFaviconService);
    delete this._faviconSvc;
    this._faviconSvc = faviconSvc;
    return this._faviconSvc;
  },

  get _currentButton() {
    let currentButton = document.getElementById("currentButton");
    delete this._currentButton;
    this._currentButton = currentButton;
    return this._currentButton;
  },

  get _unreadButton() {
    let unreadButton = document.getElementById("unreadButton");
    delete this._unreadButton;
    this._unreadButton = unreadButton;
    return this._unreadButton;
  },

  get _bodyButton() {
    let bodyButton = document.getElementById("bodyButton");
    delete this._bodyButton;
    this._bodyButton = bodyButton;
    return this._bodyButton;
  },

  get _orderButton() {
    let orderButton = document.getElementById("orderButton");
    delete this._orderButton;
    this._orderButton = orderButton;
    return this._orderButton;
  },

  // The set of messages to display in the view.
  _collection: null,
  
  // whether or not the content area has scrollbars
  _hasHorizontalScrollbar: false,
  _hasVerticalScrollbar: false,

  // the width (narrower dimension) of the vertical and horizontal scrollbars;
  // useful for calculating the viewable size of the viewport, since window.
  // innerWidth and innerHeight include the area taken up by the scrollbars
  // XXX Is this value correct, and does it vary by platform?
  scrollbarWidth: 15,

  // the viewable size of the viewport (i.e. the inner size minus the space
  // taken up by scrollbars, if any)
  get viewableWidth() {
    return window.innerWidth -
           (this._hasVerticalScrollbar ? this.scrollbarWidth : 0);
  },
  get viewableHeight() {
    return window.innerHeight -
           (this._hasHorizontalScrollbar ? this.scrollbarWidth : 0);
  },

  _window: null,
  _document: null,


  //**************************************************************************//
  // Initialization

  init: function() {
    this.resizeContentBox();
    document.getElementById("contentBox").focus();

    // Explicitly wrap |window| in an XPCNativeWrapper to make sure
    // it's a real native object! This will throw an exception if we
    // get a non-native object.
    this._window = new XPCNativeWrapper(window);
    this._document = this._window.document;

    this._collection = new SnowlCollection();
    this._rebuildSourceMenu();
    this._updateToolbar();
    this.writeContent();
  },

  /**
   * Resize the content box to the height of the viewport.  We have to do this
   * because of bug 434683.
   */
  resizeContentBox: function() {
    let toolbarHeight = document.getElementById("toolbar").boxObject.height;
    // We do this on load, when there isn't yet a horizontal scrollbar,
    // but we anticipate that there probably will be one, so we include it
    // in the calculation.  Perhap we should instead wait to resize
    // the content box until the content actually overflows horizontally.
    // XXX Why do I have to subtract *double* the width of the scrollbar???
    document.getElementById("contentBox").style.height =
      (window.innerHeight - (this.scrollbarWidth*2) - toolbarHeight) + "px";

    // Make the column splitter as tall as the content box.  It doesn't
    // resize itself, perhaps because it's (absolutely positioned) in a stack.
    document.getElementById("columnResizeSplitter").style.height =
      document.getElementById("contentBox").style.height;
  },


  //**************************************************************************//
  // Toolbar

  _updateToolbar: function() {
    this._params = {};
    let query = window.location.search.substr(1);
    for each (let param in query.split("&")) {
      let name, value;
      if (param.indexOf("=") != -1) {
        [name, value] = param.split("=");
        value = decodeURIComponent(value);
      }
      else
        name = param;
      this._params[name] = value;
    }

    if ("current" in this._params) {
      this._collection.current = true;
      this._currentButton.checked = true;
    }

    if ("unread" in this._params) {
      this._collection.read = false;
      this._unreadButton.checked = true;
    }

    if ("body" in this._params)
      this._bodyButton.checked = true;

    if ("filter" in this._params) {
      this._collection.filter = this._params.filter;
      document.getElementById("filterTextbox").value = this._params.filter;
    }

    if ("sourceID" in this._params) {
      this._collection.sourceID = this._params.sourceID;
      let menu = document.getElementById("sourceMenu");
      let item;
      for (let i = 0; item = menu.getItemAtIndex(i); i++) {
        if (item.value == this._params.sourceID) {
          menu.selectedItem = item;
          break;
        }
      }
    }

    if ("order" in this._params && this._params.order == "descending") {
      this._orderButton.checked = true;
      this._orderButton.image = "chrome://snowl/content/arrow-up.png";
      this._collection.sortOrder = -1;
    }
  },

  _rebuildSourceMenu: function() {
    let statementString = "SELECT name, id, humanURI FROM sources ORDER BY name";
    let statement = SnowlDatastore.createStatement(statementString);

    let sources = [];

    let i = 0;
    sources[i] = { id: null, name: "All" };

    try {
      // FIXME: instantiate SnowlSource objects here instead of generic objects.
      while (statement.step())
        sources[++i] = { id: statement.row.id,
                         name: statement.row.name,
                         humanURI: URI.get(statement.row.humanURI) };
    }
    finally {
      statement.reset();
    }

    let sourceMenu = document.getElementById("sourceMenu");
    sourceMenu.removeAllItems();
    for each (let source in sources) {
      let item = sourceMenu.appendItem(source.name, source.id);
      item.className = "menuitem-iconic";
      let uri = source.humanURI || URI.get("urn:use-default-icon");
      let favicon = this._faviconSvc.getFaviconImageForPage(uri);
      item.image = favicon.spec;
    }

    sourceMenu.selectedIndex = 0;
  },

  onCommandCurrentButton: function(aEvent) {
    if (this._currentButton.checked)
      this._collection.current = true;
    else
      this._collection.current = undefined;

    this.rebuildView();
    this._updateURI();
  },

  onCommandUnreadButton: function(aEvent) {
    // FIXME: instead of rebuilding from scratch each time, when going from
    // all to unread, simply hide the ones that are read (f.e. by setting a CSS
    // class on read items and then using a CSS rule to hide them).

    if (this._unreadButton.checked)
      this._collection.read = false;
    else
      this._collection.read = undefined;

    this.rebuildView();
    this._updateURI();
  },

  onCommandBodyButton: function(aEvent) {
    this.rebuildView();
    this._updateURI();
  },

  onCommandOrderButton: function(aEvent) {
    if (this._orderButton.checked) {
      this._orderButton.image = "chrome://snowl/content/arrow-up.png";
      this._collection.sortOrder = -1;
    }
    else {
      this._orderButton.image = "chrome://snowl/content/arrow-down.png";
      this._collection.sortOrder = 1;
    }

    // Presumably here we could do messages.reverse(), which would be faster,
    // but can we be sure the messages started in the reverse of the new state?
    this._collection.sort(this._collection.sortProperty,
                          this._collection.sortOrder);
    this.rebuildView();
    this._updateURI();
  },

  onCommandFilterTextbox: function(aEvent, aFilterTextbox) {
    this._collection.filter = aFilterTextbox.value;
    this.rebuildView();
    this._updateURI();
  },

  onCommandSourceMenu: function(aEvent) {
    let sourceMenu = document.getElementById("sourceMenu");
    this._collection.sourceID = sourceMenu.selectedItem.value;
    this.rebuildView();
    this._updateURI();
  },

  _updateURI: function() {
    let params = [];

    if (typeof this._collection.current != "undefined" && this._collection.current)
      params.push("current");

    if (typeof this._collection.read != "undefined" && !this._collection.read)
      params.push("unread");

    if (this._bodyButton.checked)
      params.push("body");

    if (this._collection.filter)
      params.push("filter=" + encodeURIComponent(this._collection.filter));

    if (this._collection.sourceID)
      params.push("sourceID=" + encodeURIComponent(this._collection.sourceID));

    if (this._collection.sortOrder == -1)
      params.push("order=descending");

    let gBrowserWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                         getInterface(Ci.nsIWebNavigation).
                         QueryInterface(Ci.nsIDocShellTreeItem).
                         rootTreeItem.
                         QueryInterface(Ci.nsIInterfaceRequestor).
                         getInterface(Ci.nsIDOMWindow);

    let currentURI = gBrowserWindow.gBrowser.docShell.currentURI.QueryInterface(Ci.nsIURL);

    let query = params.length > 0 ? "?" + params.join("&") : "";
    let spec = currentURI.prePath + currentURI.filePath + query;
    let uri = Cc["@mozilla.org/network/io-service;1"].
              getService(Ci.nsIIOService).
              newURI(spec, null, null);

    // Update the docshell with the new URI.  This updates the location bar
    // and gets used by the bookmarks service when the user bookmarks the page.
    gBrowserWindow.gBrowser.docShell.setCurrentURI(uri);

    // Update the session history entry for the page with the new URI.
    // This gets used when the user reloads the page or traverses history.
    let history = gBrowserWindow.gBrowser.sessionHistory;
    let historyEntry = history.getEntryAtIndex(history.index, false);
    if (historyEntry instanceof Ci.nsISHEntry)
      historyEntry.setURI(uri);
    else
      this._log.error("can't update session history URI for " +
                      "'" + historyEntry.title + "' " +
                      "<" + historyEntry.URI.spec + ">; " +
                      "entry is not an instance of nsISHEntry");
  },


  //**************************************************************************//
  // Event Handlers

  doPageMove: function(direction) {
    this.doMove(direction * this.viewableWidth);
  },

  doColumnMove: function(direction) {
    let contentBox = document.getElementById("contentBox");
    let computedStyle = window.getComputedStyle(contentBox, null);
    let columnWidth = parseInt(computedStyle.MozColumnWidth) +
                      parseInt(computedStyle.MozColumnGap);
    this.doMove(direction * columnWidth);
  },

  doMove: function(pixels) {
    let scrollBoxObject = document.getElementById('scrollBox').boxObject.
                          QueryInterface(Ci.nsIScrollBoxObject);
    scrollBoxObject.scrollBy(pixels, 0);
  },

  onHome: function() {
    let scrollBoxObject = document.getElementById('scrollBox').boxObject.
                          QueryInterface(Ci.nsIScrollBoxObject);
    scrollBoxObject.scrollTo(0, 0);
  },

  onEnd: function() {
    let scrollBoxObject = document.getElementById('scrollBox').boxObject.
                          QueryInterface(Ci.nsIScrollBoxObject);
    let width = {};
    scrollBoxObject.getScrolledSize(width, {});
    scrollBoxObject.scrollTo(width.value, 0);
  },

  /**
   * Handle overflow and underflow events. |event.detail| is 0 if vertical flow
   * changed, 1 if horizontal flow changed, and 2 if both changed.
   */
  onFlowChange: function(event) {
    let val = event.type == "overflow" ? true : false;

    switch(event.detail) {
      case 0:
        this._hasVerticalScrollbar = val;
        break;
      case 1:
        this._hasHorizontalScrollbar = val;
        break;
      case 2:
        this._hasVerticalScrollbar = val;
        this._hasHorizontalScrollbar = val;
        break;
    }
  },

  onScroll: function(aEvent) {
    this._markMessagesRead(aEvent);
  },

  // FIXME: redo this entirely now that we're using a horizontal row of columns.
  _markMessagesRead: function(aEvent) {
    // Since we generate the content dynamically, and it can change with every
    // reload, the previous scroll position isn't particularly meaningful,
    // and it could even be dangerous, since it could mean that messages
    // appearing above it get marked read when they haven't been.
    
    // I'm not sure what to do about this, since it's useful to go back
    // to the previous scroll position when going to another page and then
    // coming back to this one, and I can't figure out how to turn off scroll
    // when reloading but leave it enabled when traveling through history.

    // I could reset the scroll on unload, but that would disable the bfcache,
    // which would cause the page to get reloaded when traveling through
    // history, which I don't want.  Or I could turn off saving of the scroll
    // through nsISHEntry::saveLayoutStateFlag, but that turns it off
    // for both cases.
    
    // Maybe the right approach is to only mark messages read when the user
    // has actually scrolled by them.

    // FIXME: figure out what to do about this.

    // The vertical offset relative to the top of the document of the topmost
    // and bottommost pixels visible in the viewport.
    let viewportTopY = window.scrollY;
    let viewportBottomY = window.scrollY + window.innerHeight - 1;

    let rows = document.getElementById("messages").childNodes;
    for (let i = 0; i < rows.length; i++) {
      let row = rows[i];

      // The vertical offset relative to the top of the document of the topmost
      // and bottommost pixels of the row.
      let rowTopY = row.boxObject.y;
      let rowBottomY = row.boxObject.y + row.boxObject.height - 1;

      // If the current row is completely above the bottom of the viewport,
      // then mark it read.
      if (rowBottomY < viewportBottomY)
        this._collection.messages[i].read = true;

      // XXX If there are two messages completely visible in the viewport,
      // we currently mark both read.  Is that the correct behavior, or should
      // we only mark the topmost message read?

      // We've run into the first message that is not completely above
      // the bottom of the viewport.  There's nothing more to do, so we can
      // break out of the loop.
      // FIXME: also record the last message marked read so we can start
      // from that message next time.
      else
        break;
    }
  },


  //**************************************************************************//
  // Safe DOM Manipulation

  /**
   * Use this sandbox to run any dom manipulation code on nodes which
   * are already inserted into the content document.
   */
  __contentSandbox: null,
  get _contentSandbox() {
    if (!this.__contentSandbox)
      this.__contentSandbox = new Cu.Sandbox(this._window);

    return this.__contentSandbox;
  },

  // FIXME: use this when setting story title and byline.
  _setContentText: function FW__setContentText(id, text) {
    this._contentSandbox.element = this._document.getElementById(id);
    this._contentSandbox.textNode = this._document.createTextNode(text);
    let codeStr =
      "while (element.hasChildNodes()) " +
      "  element.removeChild(element.firstChild);" +
      "element.appendChild(textNode);";
    Cu.evalInSandbox(codeStr, this._contentSandbox);
    this._contentSandbox.element = null;
    this._contentSandbox.textNode = null;
  },

  // FIXME: use this when linkifying the story title and source.
  /**
   * Safely sets the href attribute on an anchor tag, providing the URI 
   * specified can be loaded according to rules.
   *
   * XXX Renamed from safeSetURIAttribute to unsafeSetURIAttribute to reflect
   * that we've commented out the stuff that makes it safe.
   *
   * FIXME: I don't understand the security implications here, but presumably
   * there's a reason this is here, and we should be respecting it, so make this
   * work by giving each message in a collection have a reference to its source
   * and then use the source's URI to create the principal with which we compare
   * the URI.
   * 
   * @param   element
   *          The element to set a URI attribute on
   * @param   attribute
   *          The attribute of the element to set the URI to, e.g. href or src
   * @param   uri
   *          The URI spec to set as the href
   */
  _unsafeSetURIAttribute: 
  function FW__unsafeSetURIAttribute(element, attribute, uri) {
/*
    let secman = Cc["@mozilla.org/scriptsecuritymanager;1"].
                 getService(Ci.nsIScriptSecurityManager);    
    const flags = Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL;
    try {
      secman.checkLoadURIStrWithPrincipal(this._feedPrincipal, uri, flags);
      // checkLoadURIStrWithPrincipal will throw if the link URI should not be
      // loaded, either because our feedURI isn't allowed to load it or per
      // the rules specified in |flags|, so we'll never "linkify" the link...
    }
    catch (e) {
      // Not allowed to load this link because secman.checkLoadURIStr threw
      return;
    }
*/

    this._contentSandbox.element = element;
    this._contentSandbox.uri = uri;
    let codeStr = "element.setAttribute('" + attribute + "', uri);";
    Cu.evalInSandbox(codeStr, this._contentSandbox);
  },


  //**************************************************************************//
  // Content Generation

  rebuildView: function() {
    let contentBox = this._document.getElementById("contentBox");
    while (contentBox.hasChildNodes())
      contentBox.removeChild(contentBox.lastChild);

    this.writeContent();
  },

  /**
   * A JavaScript Strands Future with which we pause the writing of messages
   * so as not to hork the UI thread.
   */
  _futureWriteMessages: null,

  /**
   * Sleep the specified number of milliseconds before continuing at the point
   * in the caller where this function was called.  For the most part, this is
   * a generic sleep routine like the one provided by JavaScript Strands,
   * but we store the Future this function creates in the _futureWriteMessages
   * property so we can interrupt it when writeMessages gets called again
   * while it is currently writing messages.
   */
  _sleepWriteMessages: strand(function(millis) {
    this._futureWriteMessages = new Future();
    setTimeout(this._futureWriteMessages.fulfill, millis);
    yield this._futureWriteMessages.result();
  }),

  writeContent: strand(function() {
    // Interrupt a strand currently writing messages so we don't both try
    // to write messages at the same time.
    // FIXME: figure out how to suppress the exception this throws to the error
    // console, since this interruption is expected and normal behavior.
    if (this._futureWriteMessages)
      this._futureWriteMessages.interrupt();

    this._contentSandbox.messages =
      this._document.getElementById("contentBox");

    for (let i = 0; i < this._collection.messages.length; ++i) {
      let message = this._collection.messages[i];

      let messageBox = this._document.createElementNS(HTML_NS, "div");
      messageBox.className = "message";
      messageBox.setAttribute("index", i);

      // Title
      let title = this._document.createElementNS(HTML_NS, "h2");
      title.className = "title";
      let titleLink = this._document.createElementNS(HTML_NS, "a");
      titleLink.appendChild(this._document.createTextNode(message.subject || "untitled"));
      if (message.link)
        this._unsafeSetURIAttribute(titleLink, "href", message.link);
      title.appendChild(titleLink);
      messageBox.appendChild(title);

      // Byline
      let bylineBox = this._document.createElementNS(HTML_NS, "div");
      bylineBox.className = "byline";
      messageBox.appendChild(bylineBox);

      // Source
      let source = this._document.createElementNS(HTML_NS, "a");
      source.className = "source";
      let sourceIcon = document.createElementNS(HTML_NS, "img");
      let sourceFaviconURI = message.source.humanURI || URI.get("urn:use-default-icon");
      sourceIcon.src = this._faviconSvc.getFaviconImageForPage(sourceFaviconURI).spec;
      source.appendChild(sourceIcon);
      source.appendChild(this._document.createTextNode(message.source.name));
      if (message.source.humanURI)
        this._unsafeSetURIAttribute(source, "href", message.source.humanURI.spec);
      bylineBox.appendChild(source);

      // Author
      //if (message.author)
      //  bylineBox.appendChild(this._document.createTextNode(message.author));

      // Timestamp
      let lastUpdated = this._formatTimestamp(new Date(message.timestamp));
      if (lastUpdated) {
        let timestamp = this._document.createElementNS(HTML_NS, "span");
        timestamp.className = "timestamp";
        timestamp.appendChild(document.createTextNode(" - " + lastUpdated));
        bylineBox.appendChild(timestamp);
      }

      // Body
      if (this._bodyButton.checked) {
        let bodyText = message.content || message.summary;
        if (bodyText) {
          let body = this._document.createElementNS(HTML_NS, "div");
          body.className = "body";
          messageBox.appendChild(body);

          if (bodyText.base)
            body.setAttributeNS(XML_NS, "base", bodyText.base.spec);

          let docFragment = bodyText.createDocumentFragment(body);
          if (docFragment)
            body.appendChild(docFragment);
        }
      }

      // FIXME: implement support for enclosures.

      this._contentSandbox.messageBox = messageBox;

      let codeStr = "messages.appendChild(messageBox)";
      Cu.evalInSandbox(codeStr, this._contentSandbox);

      // Sleep after every message so we don't hork the UI thread and users
      // can immediately start reading messages while we finish writing them.
      yield this._sleepWriteMessages(0);
    }

    this._contentSandbox.messages = null;
    this._contentSandbox.messageBox = null;
  }),

  // FIXME: this also appears in the mail view; factor it out.
  /**
   * Formats a timestamp for human consumption using the date formatting service
   * for locale-specific formatting along with some additional smarts for more
   * human-readable representations of recent timestamps.
   * @param   {Date} the timestamp to format
   * @returns a human-readable string
   */
  _formatTimestamp: function(aTimestamp) {
    let formattedString;

    let now = new Date();

    let yesterday = new Date(now - 24 * 60 * 60 * 1000);
    yesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

    let sixDaysAgo = new Date(now - 6 * 24 * 60 * 60 * 1000);
    sixDaysAgo = new Date(sixDaysAgo.getFullYear(), sixDaysAgo.getMonth(), sixDaysAgo.getDate());

    if (aTimestamp.toLocaleDateString() == now.toLocaleDateString())
      formattedString = this._dfSvc.FormatTime("",
                                               this._dfSvc.timeFormatNoSeconds,
                                               aTimestamp.getHours(),
                                               aTimestamp.getMinutes(),
                                               null);
    else if (aTimestamp > yesterday)
      formattedString = "Yesterday " + this._dfSvc.FormatTime("",
                                                              this._dfSvc.timeFormatNoSeconds,
                                                              aTimestamp.getHours(),
                                                              aTimestamp.getMinutes(),
                                                              null);
    else if (aTimestamp > sixDaysAgo)
      formattedString = this._dfSvc.FormatDateTime("",
                                                   this._dfSvc.dateFormatWeekday, 
                                                   this._dfSvc.timeFormatNoSeconds,
                                                   aTimestamp.getFullYear(),
                                                   aTimestamp.getMonth() + 1,
                                                   aTimestamp.getDate(),
                                                   aTimestamp.getHours(),
                                                   aTimestamp.getMinutes(),
                                                   aTimestamp.getSeconds());
    else
      formattedString = this._dfSvc.FormatDateTime("",
                                                   this._dfSvc.dateFormatShort, 
                                                   this._dfSvc.timeFormatNoSeconds,
                                                   aTimestamp.getFullYear(),
                                                   aTimestamp.getMonth() + 1,
                                                   aTimestamp.getDate(),
                                                   aTimestamp.getHours(),
                                                   aTimestamp.getMinutes(),
                                                   aTimestamp.getSeconds());

    return formattedString;
  }

};

let splitterDragObserver = {
  onMouseDown: function(event) {
    document.documentElement.addEventListener("mousemove", this, false);
  },

  onMouseUp: function(event) {
    document.documentElement.removeEventListener("mousemove", this, false);
  },

  // Note: because this function gets passed directly to setTimeout,
  // |this| doesn't reference splitterDragObserver inside the function.
  callback: function(width) {
    document.getElementById("contentBox").style.MozColumnWidth = width + "px";
  },

  handleEvent: function(event) {
    if (this._timeout)
      this._timeout = window.clearTimeout(this._timeout);
    document.getElementById("columnResizeSplitter").left = event.clientX;
    this._timeout = window.setTimeout(this.callback, 500, event.clientX);
  }
}
