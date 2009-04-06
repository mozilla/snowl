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

// modules that come with Firefox
// FIXME: remove this import of XPCOMUtils, as it is no longer being used.
//Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/utils.js");

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";

let gBrowserWindow = SnowlService.gBrowserWindow;

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

  get _contentBox() {
    delete this._contentBox;
    return this._contentBox = document.getElementById("contentBox");
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

  get _filter() {
    delete this._filter;
    return this._filter = document.getElementById("filterTextbox");
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
    this._contentBox.style.height = newVal + "px";

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

    // Remove/restore observers for paging with river view or bookmarks
    window.addEventListener("pageshow",
                            function() { SnowlMessageView.onPageShow(); },
                            false);

    window.addEventListener("pagehide",
                            function() { SnowlMessageView.onPageHide(); },
                            false);

    // Explicitly wrap |window| in an XPCNativeWrapper to make sure
    // it's a real native object! This will throw an exception if we
    // get a non-native object.
    this._window = new XPCNativeWrapper(window);
    this._document = this._window.document;

    // Init list with empty collection.
    this._collection = new SnowlCollection();

    // _updateToolbar selects a collection, which triggers a view rebuild,
    // so we don't have to call rebuildView here.  This is pretty convoluted,
    // though.  We should make this simpler and clearer.
    this._updateToolbar();

    this._setMidnightTimout();
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

    this.contentHeight = window.innerHeight - this.scrollbarBreadth - toolbarHeight;
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
    else {
      this._setBody(this._bodyButton.hasAttribute("checked"));
    }

    if ("filter" in this._params)
      this._filter.value = this._params.filter;

    if ("period" in this._params) {
      let item = this._periodMenuPopup.getElementsByAttribute("value", this._params.period)[0];
      if (item) {
        this._periodMenu.selectedItem = item;
        this._periodMenu.setAttribute("selectedindex", this._periodMenu.selectedIndex);
      }
    }
    else {
      // Restore persisted selection or init
      let selIndex = parseInt(this._periodMenu.getAttribute("selectedindex"));
      if (selIndex >= 0)
        this._periodMenu.selectedIndex = selIndex;
      else {
        this._periodMenu.setAttribute("selectedindex", 3); // "last7days"
        this._periodMenu.selectedIndex = 3;
      }
    }

    if ("columns" in this._params) {
      this._columnsButton.checked = true;
      // XXX This feels like the wrong place to do this, but I don't see
      // a better place at the moment.  Yuck, the whole process by which
      // the view gets built needs to get cleaned up and documented.
      this._setColumns(this._columnsButton.checked);
    }
    else {
      this._setColumns(this._columnsButton.hasAttribute("checked"));
    }

    if ("collection" in this._params) {
      CollectionsView.itemIds = this._params.collection;
    }

    // Restore saved selection
//this._log.info("_updateToolbar: itemIds = "+CollectionsView.itemIds);
    if (CollectionsView.itemIds != -1) {
      CollectionsView._tree.restoreSelection();
    }
  },

  onFilter: function() {
    this._updateURI();
    this._applyFilters();
  },

  _applyFilters: function() {
    let filters = [];

    // FIXME: use a left join here once the SQLite bug breaking left joins to
    // virtual tables has been fixed (i.e. after we upgrade to SQLite 3.5.7+).
    if (this._filter.value)
      filters.push({ expression: "messages.id IN (SELECT messageID FROM parts JOIN partsText ON parts.id = partsText.docid WHERE partsText.content MATCH :filter)",
                     parameters: { filter: SnowlUtils.appendAsterisks(this._filter.value) } });

    if (this._periodMenu.selectedItem)
      filters.push({ expression: "received >= :startTime AND received < :endTime",
                     parameters: { startTime: this._periodStartTime,
                                     endTime: this._periodEndTime } });

    this._collection.filters = filters;

    if (CollectionsView.itemIds == -1)
      // No selection, don't show anything
      this._collection.clear();
    else
      this._collection.invalidate();

    this._rebuildView();
  },

  onCommandBodyButton: function() {
    this._setBody(this._bodyButton.checked);
    this._updateURI();
  },

  _setBody: function(showBody) {
    if (showBody) {
      let classes = this._contentBox.className.split(/\s/);
      classes.push("showBody");
      this._contentBox.className = classes.join(" ");
    }
    else {
      this._contentBox.className = this._contentBox.className.
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
    this._periodMenu.setAttribute("selectedindex", this._periodMenu.selectedIndex);
    this._updateURI();
    this._applyFilters();
  },

  _updateURI: function() {
    let params = [];

    if (this._bodyButton.checked)
      params.push("body");

    if (this._columnsButton.checked)
      params.push("columns");

    if (CollectionsView.itemIds && CollectionsView.itemIds != -1)
      params.push("collection=" + CollectionsView.itemIds)

    if (this._filter.value)
      params.push("filter=" + encodeURIComponent(this._filter.value));

    let selIndex = parseInt(this._periodMenu.getAttribute("selectedindex"));
    if (selIndex != -1) {
      this._periodMenu.selectedIndex = selIndex;
      params.push("period=" + encodeURIComponent(this._periodMenu.selectedItem.value));
    }

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

  onPageShow: function() {
    CollectionsView.loadObservers();
  },

  onPageHide: function() {
    CollectionsView.unloadObservers();
  },

  onMessageAdded: function(message) {
this._log.info("onMessageAdded: REFRESH RIVER");
    // Don't add the message if the view isn't showing the latest available
    // messages.  Currently, that only happens when the user selects "yesterday"
    // from the period menu.
    let period = this._periodMenu.selectedItem ? this._periodMenu.selectedItem.value : "all";
    if (period == "yesterday")
      return;

    // Rebuild the view instead of adding the message if the view is showing
    // a filtered set of messages, since we don't yet have code to determine
    // if the new message belongs to the filtered set.
    // FIXME: figure out a way to determine that; perhaps a message could have
    // a method that takes a filter string and returns a boolean for whether or
    // not the message content matches the string.
    if (this._filter.value) {
      this._collection.invalidate();
      this._rebuildView();
      return;
    }

    // Add the message to the view.
//this._log.info("onMessageAdded: REFRESH RIVER message = "+message.toSource());

    // Find the group box into which we're going to insert the message.
    let groups = SnowlDateUtils.periods[period];
    let groupIndex = 0;
    while (message.received < groups[groupIndex].epoch)
      ++groupIndex;
    let groupBoxes = this._contentBox.getElementsByClassName("groupBox");
    let groupBox = groupBoxes[groupIndex];

    // Build the message box and add it to the group box.
    let messageBox = this._buildMessageBox(message);
    groupBox.insertBefore(messageBox, groupBox.firstChild);
  },

  onCollectionsDeselect: function() {
    this._updateURI();
    this._collection.clear();
    this._collection.constraints = null;
    this._rebuildView();
  },

  onMidnight: function() {
    this._setMidnightTimout();
    this._rebuildView();
  },

  doPageMove: function(direction) {
    // element.clientWidth is the width of an element not including the space
    // taken up by a vertical scrollbar, if any, so it should be the right
    // number of pixels to scroll whether or not there is a vertical scrollbar
    // (which there shouldn't ever be but sometimes is anyway because of bugs
    // or limitations in the column breaking algorithm).  However, for some
    // reason clientWidth is actually 18 pixels less than the number of pixels
    // to scroll, so we have to add back that number of pixels.
    let pixelsToScroll = this._contentBox.clientWidth + 18;

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
    let computedStyle = window.getComputedStyle(this._contentBox, null);
    let columnWidth = parseInt(computedStyle.MozColumnWidth) +
                      parseInt(computedStyle.MozColumnGap);
    this.doMove(direction * columnWidth);
  },

  doMove: function(pixels) {
    this._contentBox.scrollLeft = this._contentBox.scrollLeft + pixels;
  },

  onHome: function() {
    this._contentBox.scrollLeft = 0;
  },

  onEnd: function() {
    this._contentBox.scrollLeft = this._contentBox.scrollWidth;
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
  },


  //**************************************************************************//
  // Content Generation

  /**
   * A JavaScript Strands Future with which we pause the rebuilding of the view
   * for a bit after each message so as not to hork the UI thread.
   */
  _futureRebuildView: null,

  /**
   * Sleep the specified number of milliseconds before continuing at the point
   * in the caller where this function was called.  For the most part, this is
   * a generic sleep routine like the one provided by JavaScript Strands,
   * but we store the Future this function creates in the _futureRebuildView
   * property so we can interrupt it when rebuildView gets called again
   * while it is currently running.
   */
  _sleepRebuildView: strand(function(millis) {
    this._futureRebuildView = new Future();
    setTimeout(this._futureRebuildView.fulfill, millis);
    yield this._futureRebuildView.result();
  }),

  _rebuildView: strand(function() {
    let begin = new Date();

    // Reset the view by removing all its groups and messages.
    // XXX Since contentBox is an HTML div, could we do this more quickly
    // by setting innerHTML to an empty string?
    while (this._contentBox.hasChildNodes())
      this._contentBox.removeChild(this._contentBox.lastChild);

    // Interrupt a strand currently rebuilding the view so we don't both try
    // to rebuild the view at the same time.
    // FIXME: figure out how to suppress the exception this throws to the error
    // console, since this interruption is expected and normal behavior.
    if (this._futureRebuildView)
      this._futureRebuildView.interrupt();

    let period = this._periodMenu.selectedItem ? this._periodMenu.selectedItem.value : "all";
    let groups = SnowlDateUtils.periods[period];

    // Build the box for each group and add it to the view.
    for each (let group in groups) {
      let header = this._document.createElementNS(XUL_NS, "checkbox");
      header.className = "twistbox";
      header.setAttribute("label", group.name);
      header.setAttribute("checked", "true");
      let listener = function(event) {
        // FIXME: set the |hidden| attribute rather than |style.display|.
        event.target.nextSibling.style.display = event.target.checked ? "block" : "none";
      };
      header.addEventListener("command", listener, false);
      this._contentBox.appendChild(header);

      let container = this._document.createElementNS(HTML_NS, "div");
      container.className = "groupBox";
      this._contentBox.appendChild(container);
    }

    // Build the box for each message and add it to the view.
    let groupBoxes = this._contentBox.getElementsByClassName("groupBox");
    let groupIndex = 0;
    for (let i = 0; i < this._collection.messages.length; ++i) {
      let message = this._collection.messages[i];

      // Find the group to which the message belongs.
      while (message.received < groups[groupIndex].epoch)
        ++groupIndex;

      let messageBox = this._buildMessageBox(message);
      groupBoxes[groupIndex].appendChild(messageBox);
      yield this._sleepRebuildView(this._rebuildViewTimeout);
    }

    this._log.info("time spent building view: " + (new Date() - begin) + "ms\n");
  }),

  _buildMessageBox: function(message) {
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

    // Timestamp
    let timestamp = SnowlDateUtils._formatDate(message.timestamp);
    if (timestamp) {
      let span = this._document.createElementNS(HTML_NS, "span");
      span.className = "timestamp";
      span.appendChild(this._document.createTextNode(timestamp));
      if (bylineBox.hasChildNodes())
        bylineBox.appendChild(this._document.createTextNode(" - "));
      bylineBox.appendChild(span);
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
    //  SnowlUtils.safelySetURIAttribute(source, "href", message.source.humanURI.spec, message.source.principal);
    //bylineBox.appendChild(source);

    // Title
    if (message.subject) {
      title = this._document.createElementNS(HTML_NS, "h2");
      title.className = "title";
      let titleLink = this._document.createElementNS(HTML_NS, "a");
      titleLink.appendChild(this._document.createTextNode(message.subject));
      if (message.link)
        SnowlUtils.safelySetURIAttribute(titleLink, "href", message.link, message.source.principal);
      title.appendChild(titleLink);
    }

    // Body
    let bodyText = message.content || message.summary;
    if (bodyText) {
      body = this._document.createElementNS(HTML_NS, "div");
      body.className = "body";

      if (bodyText.type == "text") {
        SnowlUtils.linkifyText(bodyText.text, body, message.source.principal);
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

      SnowlUtils.linkifyText(message.excerpt, excerpt, message.source.principal);
    }

    // FIXME: implement support for enclosures.

    messageBox.appendChild(messageIcon);
    if (message.subject)
      messageBox.appendChild(title);
    messageBox.appendChild(excerpt);
    messageBox.appendChild(body);
    messageBox.appendChild(bylineBox);

    return messageBox;
  },

  get _rebuildViewTimeout() {
    let timeout;

    // Calculate the distance between the content currently being displayed
    // in the content box and the content at the end of the box.  This tells
    // us how close the user is to the end of the content, which we can use
    // to determine how quickly to append more content to the box (the closer
    // the user is to the end, the more quickly we append more content to it,
    // so they don't run out of stuff to read).
    let totalPixels, scrolledPixels, boxExtent;
    if (this._columnsButton.checked) {
      totalPixels =     this._contentBox.scrollWidth;
      scrolledPixels =  this._contentBox.scrollLeft;
      boxExtent =       this._contentBox.clientWidth;
    }
    else {
      totalPixels =     this._contentBox.scrollHeight;
      scrolledPixels =  this._contentBox.scrollTop;
      boxExtent =       this._contentBox.clientHeight;
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
    timeout = distance / 25;
    let ceiling = this._bodyButton.checked ? 300 : 25;
    if (timeout > ceiling)
      timeout = ceiling;

    return timeout;
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
    let width = event.clientX - SnowlMessageView._contentBox.offsetLeft;
    document.getElementById("columnResizeSplitter").left = width;
    this._timeout = window.setTimeout(this.callback, 500, width);
  }
};

// From browser.js for Places sidebar
var XULBrowserWindow = {
  // Stored Status, Link and Loading values
  overLink: "",
  statusText: "",

  get statusTextField () {
    delete this.statusTextField;
    return this.statusTextField = gBrowserWindow.
                                  document.getElementById("statusbar-display");
  },

  destroy: function () {
    // XXXjag to avoid leaks :-/, see bug 60729
    delete this.statusTextField;
    delete this.statusText;
  },

  // Defined in collections.js and shared.
  // setOverLink: function (link, b) { },

  updateStatusField: function () {
    var text = this.overLink;

    // check the current value so we don't trigger an attribute change
    // and cause needless (slow!) UI updates
    if (this.statusText != text) {
      this.statusTextField.label = text;
      this.statusText = text;
    }
  }
}
