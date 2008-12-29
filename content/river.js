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

// modules that come with Firefox
// FIXME: remove this import of XPCOMUtils, as it is no longer being used.
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/service.js");
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

let gMessageViewWindow = window;

let SnowlMessageView = {
  get _log() {
    delete this._log;
    return this._log = Log4Moz.repository.getLogger("Snowl.River");
  },

  // Favicon Service
  get _faviconSvc() {
    let faviconSvc = Cc["@mozilla.org/browser/favicon-service;1"].
                     getService(Ci.nsIFaviconService);
    delete this._faviconSvc;
    this._faviconSvc = faviconSvc;
    return this._faviconSvc;
  },

  /**
   * A sandbox in which to run DOM manipulation code on nodes in the document.
   * Based on similar code in FeedWriter.js.  It's not clear why we need to use
   * a sandbox for the kinds of DOM manipulations we do, but FeedWriter.js uses
   * one, so we do the same.
   *
   * Note: FeedWriter.js says its sandbox is only for manipulating nodes that
   * "are already inserted into the content document", and perusal of its code
   * reveals that it indeed uses it that way, so we do the same.
   *
   * FIXME: figure out why we need to use a sandbox and explain it here.
   */
  get _sandbox() {
    delete this._sandbox;
    return this._sandbox = new Cu.Sandbox("about:blank");
  },

  get _bodyButton() {
    let bodyButton = document.getElementById("bodyButton");
    delete this._bodyButton;
    this._bodyButton = bodyButton;
    return this._bodyButton;
  },

  get _columnsButton() {
    let columnsButton = document.getElementById("columnsButton");
    delete this._columnsButton;
    this._columnsButton = columnsButton;
    return this._columnsButton;
  },

  get _filterTextbox() {
    delete this._filterTextbox;
    return this._filterTextbox = document.getElementById("filterTextbox");
  },

  get _periodMenu() {
    delete this._periodMenu;
    return this._periodMenu = document.getElementById("periodMenu");
  },

  get _periodMenuPopup() {
    delete this._periodMenuPopup;
    return this._periodMenuPopup = document.getElementById("periodMenuPopup");
  },

  get _periodStartTime() {
    if (!this._periodMenu.selectedItem)
      return 0;

    switch (this._periodMenu.selectedItem.value) {
      case "today":
        return SnowlDateUtils.jsToJulianDate(SnowlDateUtils.today);
      case "yesterday":
        return SnowlDateUtils.jsToJulianDate(SnowlDateUtils.yesterday);
      case "last7days":
        return SnowlDateUtils.jsToJulianDate(SnowlDateUtils.sixDaysAgo.epoch);
      case "last4weeks":
        return SnowlDateUtils.jsToJulianDate(SnowlDateUtils.fourWeeksAgo.epoch);
      case "all":
      default:
        return 0;
    }
  },

  get _periodEndTime() {
    if (!this._periodMenu.selectedItem)
      return Number.MAX_VALUE;

    switch (this._periodMenu.selectedItem.value) {
      // Yesterday means only that day, but the rest of the periods are fairly
      // open-ended, since they all include today, and in theory there shouldn't
      // be any messages received after today.  I suppose we could exclude
      // messages received in the future from these categories, but since that
      // situation is exceptional, it's probably better to show those.
      case "yesterday":
        return SnowlDateUtils.jsToJulianDate(SnowlDateUtils.today);
      case "today":
      case "last7days":
      case "last4weeks":
      case "all":
      default:
        return Number.MAX_VALUE;
    }
  },

  get _writeButton() {
    delete this._writeButton;
    return this._writeButton = document.getElementById("writeButton");
  },

  get _writeForm() {
    delete this._writeForm;
    return this._writeForm = document.getElementById("writeForm");
  },

  // The set of messages to display in the view.
  _collection: null,
  
  // whether or not the content area has scrollbars
  _hasHorizontalScrollbar: false,
  _hasVerticalScrollbar: false,

  // The size of vertical and horizontal scrollbars across their narrower
  // dimension (i.e. the width of vertical scrollbars and height of horizontal
  // ones).  Useful for calculating the viewable size of the viewport, since
  // window.innerWidth and innerHeight include the area taken up by scrollbars.
  // XXX Is this value correct, and does it vary by platform?
  scrollbarBreadth: 15,

  get contentStylesheet() {
    for (let i = 0; i < document.styleSheets.length; i++)
      if (document.styleSheets[i].href == "chrome://snowl/content/riverContent.css")
        return document.styleSheets[i];
    return null;
  },

  set columnWidth(newVal) {
    this._updateContentRule(0, "#contentStack[columns] > #contentBox " +
                               "{ -moz-column-width: " + newVal + "px }");

    // Set the maximum width for images in the content so they don't stick out
    // the side of the columns.
    this._updateContentRule(1, "#contentBox img { max-width: " + newVal + "px }");
  },

  _updateContentRule: function(position, newValue) {
    this.contentStylesheet.deleteRule(position);
    this.contentStylesheet.insertRule(newValue, position);
  },

  set contentHeight(newVal) {
    document.getElementById("contentBox").style.height = newVal + "px";

    // Make the column splitter as tall as the content box.  It doesn't
    // resize itself, perhaps because it's (absolutely positioned) in a stack.
    document.getElementById("columnResizeSplitter").style.height = newVal + "px";

    // Set the maximum height for images and tables in the content so they
    // don't make the columns taller than the height of the content box.
    this._updateContentRule(2, "#contentBox img { max-height: " + newVal + "px }");
    this._updateContentRule(3, "#contentBox table { max-height: " + newVal + "px }");
  },

  _window: null,
  _document: null,


  //**************************************************************************//
  // Initialization

  _init: function() {
    Observers.add("snowl:message:added",    this.onMessageAdded,    this);

    // FIXME: simplify the way the view gets built after the collections view
    // gets loaded to make this code less buggy and easier to hack.

    // Finish initializing after a brief timeout to give the collections view
    // time to initialize itself.
    let t = this;
    window.setTimeout(function() { t._initDelayed() }, 0);

    this._initWriteForm();
    this._updateWriteButton();
  },

  _initDelayed: function() {
    // Resize the content box to the initial size of the browser.
    this.resizeContentBox();

    // Listen for resize events so we can resize the content box when the size
    // of the browser changes.  We set this event listener here rather than
    // in an onresize attribute on the page element because loading this view
    // on startup can cause a resize event to fire before the view is loaded
    // (and thus before SnowlMessageView has been defined), which would cause
    // an attribute-based listener to throw an exception.
    window.addEventListener("resize",
                            function() SnowlMessageView.resizeContentBox(),
                            false);

    // Explicitly wrap |window| in an XPCNativeWrapper to make sure
    // it's a real native object! This will throw an exception if we
    // get a non-native object.
    this._window = new XPCNativeWrapper(window);
    this._document = this._window.document;

    //this._collection = new SnowlCollection();
    this._updateToolbar();
    //this.writeContent();

    this._setMidnightTimout();
  },

  /**
   * Resize the content box to the height of the viewport.  We have to do this
   * because of bug 434683.
   */
  resizeContentBox: function() {
    let toolbarHeight = document.getElementById("toolbar").boxObject.height;
    let writeFormHeight = document.getElementById("writeForm").boxObject.height;

    // We do this on load, when there isn't yet a horizontal scrollbar,
    // but we anticipate that there probably will be one, so we include it
    // in the calculation.  Perhap we should instead wait to resize
    // the content box until the content actually overflows horizontally.
    this.contentHeight =
      window.innerHeight - this.scrollbarBreadth - toolbarHeight - writeFormHeight;
  },

  _setMidnightTimout: function() {
    let t = this;
    let now = new Date();
    let msUntilMidnight = SnowlDateUtils.tomorrow - now;
    this._log.info("setting midnight timeout for " + new Date(now.getTime() + msUntilMidnight));
    window.setTimeout(function() { t.onMidnight() }, msUntilMidnight);
  },

  _initWriteForm: function() {
    // For some reason setting hidden="true" in the XUL file prevents us
    // from showing the box later via writeForm.hidden = false, so we set it
    // here instead.
    // FIXME: file a bug on this abnormality.
    this._writeForm.hidden = true;
  },

  // Selectively enable/disable the button for writing a message depending on
  // whether or not the user has an account that supports writing.
  _updateWriteButton: function() {
    this._writeButton.disabled = (SnowlService.targets.length == 0);
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

    if ("body" in this._params) {
      this._bodyButton.checked = true;
      this._setBody(true);
    }

    if ("filter" in this._params)
      document.getElementById("filterTextbox").value = this._params.filter;

    if ("period" in this._params) {
      let item = this._periodMenuPopup.getElementsByAttribute("value", this._params.period)[0];
      if (item)
        this._periodMenu.selectedItem = item;
    }
    // By default, show one week.
    else
      this._periodMenu.selectedIndex = 3;

    if ("columns" in this._params) {
      this._columnsButton.checked = true;
      // XXX This feels like the wrong place to do this, but I don't see
      // a better place at the moment.  Yuck, the whole process by which
      // the view gets built needs to get cleaned up and documented.
      this._setColumns(this._columnsButton.checked);
    }

    let selected = false;
    if ("collection" in this._params) {
      //dump("this._params.collection: " + this._params.collection + "; this._params.group: " + this._params.group + "\n");
      for (let i = 0; i < CollectionsView._rows.length; i++) {
        let collection = CollectionsView._rows[i];
        //dump("collection id: " + collection.id + "; parent id: " + (collection.parent ? collection.parent.id : "no parent") + "; collection.name = " + collection.name + "\n");
        if (collection.id == this._params.collection) {
          CollectionsView._tree.view.selection.select(i);
          selected = true;
          break;
        }
        else if ("group" in this._params &&
                 collection.parent &&
                 collection.parent.id == this._params.collection &&
                 collection.name == this._params.group) {
          CollectionsView._tree.view.selection.select(i);
          selected = true;
          break;
        }
      }
    }
    if (!selected)
      CollectionsView._tree.view.selection.select(0);

  },

  onFilter: function() {
    this._updateURI();
    this._applyFilters();
  },

  _applyFilters: function() {
    let filters = [];

    // FIXME: use a left join here once the SQLite bug breaking left joins to
    // virtual tables has been fixed (i.e. after we upgrade to SQLite 3.5.7+).
    if (this._filterTextbox.value)
      filters.push({ expression: "messages.id IN (SELECT messageID FROM parts JOIN partsText ON parts.id = partsText.docid WHERE partsText.content MATCH :filter)",
                     parameters: { filter: SnowlUtils.appendAsterisks(this._filterTextbox.value) } });

    if (this._periodMenu.selectedItem)
      filters.push({ expression: "received >= :startTime AND received < :endTime",
                     parameters: { startTime: this._periodStartTime,
                                     endTime: this._periodEndTime } });

    this._collection.filters = filters;

    this._collection.invalidate();
    this.rebuildView();
  },

  onCommandBodyButton: function() {
    this._setBody(this._bodyButton.checked);
    this._updateURI();
  },

  _setBody: function(showBody) {
    let contentBox = document.getElementById("contentBox");
    if (showBody) {
      let classes = contentBox.className.split(/\s/);
      classes.push("showBody");
      contentBox.className = classes.join(" ");
    }
    else {
      contentBox.className = contentBox.className.
                             split(/\s/).
                             filter(function(v) v != "showBody").
                             join(" ");
    }
  },

  onCommandColumnsButton: function() {
    this._setColumns(this._columnsButton.checked);
    this._updateURI();
  },

  _setColumns: function(columns) {
    if (columns) {
      document.getElementById("contentStack").setAttribute("columns", true);
      // Enable the keys that map PageUp and PageDown to PageLeft and PageRight.
      document.getElementById("pageLeftKey").removeAttribute("disabled");
      document.getElementById("pageRightKey").removeAttribute("disabled");
    }
    else {
      document.getElementById("contentStack").removeAttribute("columns");
      document.getElementById("pageLeftKey").setAttribute("disabled", "true");
      document.getElementById("pageRightKey").setAttribute("disabled", "true");
    }
    
  },

  onCommandPeriodMenu: function(event) {
    this._updateURI();
    this._applyFilters();
  },

  _updateURI: function() {
    let params = [];

    if (this._bodyButton.checked)
      params.push("body");

    if (this._columnsButton.checked)
      params.push("columns");

    // FIXME: don't add the collection if it's the default All collection,
    // but do add it if it's already in the list of params.
    if (this._collection.id)
      params.push("collection=" + this._collection.id);
    else if (this._collection.parent) {
      params.push("collection=" + this._collection.parent.id);
      params.push("group=" + encodeURIComponent(this._collection.name));
    }

    if (this._filterTextbox.value)
      params.push("filter=" + encodeURIComponent(this._filterTextbox.value));

    // FIXME: do add the All period if it's already in the list of params.
    if (this._periodMenu.selectedItem && this._periodMenu.selectedItem.value != "all")
      params.push("period=" + encodeURIComponent(this._periodMenu.selectedItem.value));

    let browser = gBrowserWindow.gBrowser.getBrowserForDocument(document);

    let currentURI = browser.docShell.currentURI.QueryInterface(Ci.nsIURL);

    let query = params.length > 0 ? "?" + params.join("&") : "";
    let spec = currentURI.prePath + currentURI.filePath + query;
    let uri = Cc["@mozilla.org/network/io-service;1"].
              getService(Ci.nsIIOService).
              newURI(spec, null, null);

    // Update the docshell with the new URI.  This updates the location bar
    // and gets used by the bookmarks service when the user bookmarks the page.
    browser.docShell.setCurrentURI(uri);

    // Update the session history entry for the page with the new URI.
    // This gets used when the user reloads the page or traverses history.
    let history = browser.sessionHistory;
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
  // Event & Notification Handlers

  onLoad: function() {
    this._init();
  },

  onMessageAdded: function(topic, message) {
    // Don't add the message if the view isn't showing the latest available
    // messages.  Currently, that only happens when the user selects "yesterday"
    // from the period menu.
    let period = this._periodMenu.selectedItem ? this._periodMenu.selectedItem.value : "all";
    if (period == "yesterday")
      return;

    // Rebuild the view instead of adding the message if the view is showing
    // a filtered set of messages, since we don't have a way to determine
    // if the new message belongs to the filtered set.
    // FIXME: figure out a way to determine that; perhaps a message could have
    // a method that takes a filter string and returns a boolean for whether or
    // not the message content matches the string.
    let filter = this._filterTextbox.value;
    if (filter != "") {
      this._collection.invalidate();
      this.rebuildView();
      return;
    }

    // Build the message representation and add it to the view.
    this._sandbox.messages = this._document.getElementById("contentBox").
                             getElementsByClassName("groupBox")[0];
    this._sandbox.messageBox = this._buildMessageView(message);
    let codeStr = "messages.insertBefore(messageBox, messages.firstChild)";
    Cu.evalInSandbox(codeStr, this._sandbox);
    this._sandbox.messages = null;
    this._sandbox.messageBox = null;
  },

  onMidnight: function() {
    this._setMidnightTimout();
    this.rebuildView();
  },

  doPageMove: function(direction) {
    let contentBox = document.getElementById("contentBox");

    // element.clientWidth is the width of an element not including the space
    // taken up by a vertical scrollbar, if any, so it should be the right
    // number of pixels to scroll whether or not there is a vertical scrollbar
    // (which there shouldn't ever be but sometimes is anyway because of bugs
    // or limitations in the column breaking algorithm).  However, for some
    // reason clientWidth is actually 18 pixels less than the number of pixels
    // to scroll, so we have to add back that number of pixels.
    let pixelsToScroll = contentBox.clientWidth + 18;

    // FIXME: file a bug on clientWidth being 18 pixels less than the width
    // of the page (if it really is; first, measure to make sure it's the case,
    // as the bug could be an issue with column placement instead).

    this.doMove(direction * pixelsToScroll);
  },

  // Note: this doesn't really work because the computed column width
  // isn't the same as the actual width.  Bug 463828 is about Gecko providing
  // a way to get the actual width (perhaps by making the computed width
  // be the actual width).
  // FIXME: fix this once bug 463828 is fixed.
  doColumnMove: function(direction) {
    let contentBox = document.getElementById("contentBox");
    let computedStyle = window.getComputedStyle(contentBox, null);
    let columnWidth = parseInt(computedStyle.MozColumnWidth) +
                      parseInt(computedStyle.MozColumnGap);
    this.doMove(direction * columnWidth);
  },

  doMove: function(pixels) {
    let contentBox = document.getElementById("contentBox");
    contentBox.scrollLeft = contentBox.scrollLeft + pixels;
  },

  onHome: function() {
    let contentBox = document.getElementById("contentBox");
    contentBox.scrollLeft = 0;
  },

  onEnd: function() {
    let contentBox = document.getElementById("contentBox");
    contentBox.scrollLeft = contentBox.scrollWidth;
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

  setCollection: function(collection) {
    this._collection = collection;
    this._collection.order = "messages.id DESC";
    this._updateURI();
    this._applyFilters();
    // No need to rebuild the view here, as _applyFilters will do it for us.
    // XXX Should we pull the call to rebuildView out of _applyFilters?
  },

  onToggleWrite: function(event) {
    this._writeForm.hidden = !event.target.checked;
    this.resizeContentBox();
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
    let begin = new Date();

    // Interrupt a strand currently writing messages so we don't both try
    // to write messages at the same time.
    // FIXME: figure out how to suppress the exception this throws to the error
    // console, since this interruption is expected and normal behavior.
    if (this._futureWriteMessages)
      this._futureWriteMessages.interrupt();

    let contentBox = this._document.getElementById("contentBox");
    this._sandbox.messages = contentBox;

    let period = this._periodMenu.selectedItem ? this._periodMenu.selectedItem.value : "all";
    let groups = SnowlDateUtils.periods[period];
    let groupIndex = 0;

    for (let i = 0; i < this._collection.messages.length; ++i) {
      let message = this._collection.messages[i];

      while (message.received < groups[groupIndex].epoch) {
        ++groupIndex;

        let header = this._document.createElementNS(XUL_NS, "checkbox");
        header.className = "twistbox";
        header.setAttribute("label", groups[groupIndex].name);
        header.setAttribute("checked", "true");
        let listener = function(event) {
          event.target.nextSibling.style.display = event.target.checked ? "block" : "none";
        };
        header.addEventListener("command", listener, false);
        contentBox.appendChild(header);

        let container = this._document.createElementNS(HTML_NS, "div");
        container.className = "groupBox";
        contentBox.appendChild(container);

        this._sandbox.messages = container;
      }

      let messageBox = this._buildMessageView(message);

      this._sandbox.messageBox = messageBox;

      let codeStr = "messages.appendChild(messageBox)";
      Cu.evalInSandbox(codeStr, this._sandbox);

      // Calculate the distance between the content currently being displayed
      // in the content box and the content at the end of the box.  This tells
      // us how close the user is to the end of the content, which we can use
      // to determine how quickly to append more content to the box (the closer
      // the user is to the end, the quicker we append more content to it, so
      // they don't run out of stuff to read).
      let totalPixels, scrolledPixels, boxExtent;
      if (this._columnsButton.checked) {
        totalPixels = contentBox.scrollWidth;
        scrolledPixels = contentBox.scrollLeft;
        boxExtent = contentBox.clientWidth;
      }
      else {
        totalPixels = contentBox.scrollHeight;
        scrolledPixels = contentBox.scrollTop;
        boxExtent = contentBox.clientHeight;
      }

      // Subtracting the box extent from the total pixels gives us
      // the distance from the current position to the beginning rather than
      // the end of the last page of content.
      let distance = totalPixels - boxExtent - scrolledPixels;

      // Sleep to give the UI thread time to do other things.  We sleep longer
      // the farther away the user is from the end of the page, and we also
      // sleep longer if we're displaying full content, since it takes longer
      // to display.  Our rough algorithm is to divide the distance from the end
      // of the page by some divisor, limiting the output to a certain ceiling.
      let timeout = distance / 25;
      let ceiling = this._bodyButton.checked ? 300 : 25;
      if (timeout > ceiling)
        timeout = ceiling;
      yield this._sleepWriteMessages(timeout);
    }

    this._sandbox.messages = null;
    this._sandbox.messageBox = null;

    this._log.info("time spent building view: " + (new Date() - begin) + "ms\n");
  }),

  _buildMessageView: function(message) {
    let messageBox = this._document.createElementNS(HTML_NS, "div");
    messageBox.className = "message";

    // These are the elements that will be appended to the message box.
    let messageIcon, bylineBox, title, excerpt, body;

    messageIcon = document.createElementNS(HTML_NS, "img");
    excerpt = document.createElementNS(HTML_NS, "span");
    excerpt.className = "excerpt";

    // Byline
    bylineBox = this._document.createElementNS(HTML_NS, "div");
    bylineBox.className = "byline";

    // Author and/or Source
    if (message.author)
      bylineBox.appendChild(this._document.createTextNode(message.author));
    if (message.source) {
      if (message.author)
        bylineBox.appendChild(this._document.createTextNode(" - "));
      bylineBox.appendChild(this._document.createTextNode(message.source.name));
    }

    // Source
    //let source = this._document.createElementNS(HTML_NS, "a");
    //source.className = "source";
    //let sourceIcon = document.createElementNS(HTML_NS, "img");
    //let sourceFaviconURI = message.source.humanURI || URI.get("urn:use-default-icon");
    //sourceIcon.src = this._faviconSvc.getFaviconImageForPage(sourceFaviconURI).spec;
    //source.appendChild(sourceIcon);
    //source.appendChild(this._document.createTextNode(message.source.name));
    //if (message.source.humanURI)
    //  SnowlUtils.safelySetURIAttribute(source, "href", message.source.humanURI.spec, message.source.principal, this._sandbox);
    //bylineBox.appendChild(source);

    // Title
    if (message.subject) {
      title = this._document.createElementNS(HTML_NS, "h2");
      title.className = "title";
      let titleLink = this._document.createElementNS(HTML_NS, "a");
      titleLink.appendChild(this._document.createTextNode(message.subject));
      if (message.link)
        SnowlUtils.safelySetURIAttribute(titleLink, "href", message.link, message.source.principal, this._sandbox);
      title.appendChild(titleLink);
    }

    // Body
    let bodyText = message.content || message.summary;
    if (bodyText) {
      body = this._document.createElementNS(HTML_NS, "div");
      body.className = "body";

      if (bodyText.type == "text") {
        SnowlUtils.linkifyText(bodyText.text, body, message.source.principal, this._sandbox);
      }
      else {
        if (bodyText.base)
          body.setAttributeNS(XML_NS, "base", bodyText.base.spec);
  
        let docFragment = bodyText.createDocumentFragment(body);
        if (docFragment) {
          body.appendChild(docFragment);
  
          // Generate an icon representing the message.
          let firstImage = body.getElementsByTagName("img")[0];
          if (firstImage) {
            messageIcon = firstImage.cloneNode(false);
            messageIcon.removeAttribute("width");
            messageIcon.removeAttribute("height");
            messageIcon.className = "messageIcon";
          }
        }
      }

      SnowlUtils.linkifyText(message.excerpt, excerpt, message.source.principal, this._sandbox);
    }

    //// Timestamp
    //let lastUpdated = SnowlDateUtils._formatDate(message.timestamp);
    //if (lastUpdated) {
    //  let timestamp = this._document.createElementNS(HTML_NS, "span");
    //  timestamp.className = "timestamp";
    //  timestamp.appendChild(document.createTextNode(lastUpdated));
    //  if (bylineBox.hasChildNodes())
    //    bylineBox.appendChild(this._document.createTextNode(" - "));
    //  bylineBox.appendChild(timestamp);
    //}

    // FIXME: implement support for enclosures.

    messageBox.appendChild(messageIcon);
    if (message.subject)
      messageBox.appendChild(title);
    messageBox.appendChild(excerpt);
    messageBox.appendChild(body);
    messageBox.appendChild(bylineBox);

    return messageBox;
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
    SnowlMessageView.columnWidth = width;
  },

  handleEvent: function(event) {
    if (this._timeout)
      this._timeout = window.clearTimeout(this._timeout);
    let width = event.clientX - document.getElementById("contentBox").offsetLeft;
    document.getElementById("columnResizeSplitter").left = width;
    this._timeout = window.setTimeout(this.callback, 500, width);
  }
}
