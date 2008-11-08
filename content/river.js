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
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// modules that should come with Firefox
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/collection.js");
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
    return this._log = Log4Moz.Service.getLogger("Snowl.River");
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
        return SnowlDateUtils.jsToJulianDate(SnowlDateUtils.twentySevenDaysAgo.epoch);
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

  init: function() {
    // FIXME: use the Observers module to observe message change
    // or message added notifications and rebuild the view when they happen.

    // FIXME: simplify the way the view gets built after the collections view
    // gets loaded to make this code less buggy and easier to hack.

    // Finish initializing after a brief timeout to give the collections view
    // time to initialize itself.
    let t = this;
    window.setTimeout(function() { t._initDelayed() }, 0);
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

    // We do this on load, when there isn't yet a horizontal scrollbar,
    // but we anticipate that there probably will be one, so we include it
    // in the calculation.  Perhap we should instead wait to resize
    // the content box until the content actually overflows horizontally.
    // XXX Why do I have to subtract *double* the width of the scrollbar???
    // Maybe it's because of the 7px padding all around the contentBox?
    this.contentHeight =
      window.innerHeight - (this.scrollbarWidth*2) - toolbarHeight;
  },

  _setMidnightTimout: function() {
    let t = this;
    let now = new Date();
    let msUntilMidnight = SnowlDateUtils.tomorrow - now;
    this._log.info("setting midnight timeout for " + new Date(now.getTime() + msUntilMidnight));
    window.setTimeout(function() { t.onMidnight() }, msUntilMidnight);
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

    if ("current" in this._params)
      this._currentButton.checked = true;

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

  onFilter: function(aEvent) {
    this._updateURI();
    this._applyFilters();
  },

  onCommandCurrentButton: function(aEvent) {
    this._updateURI();
    this._applyFilters();
  },

  _applyFilters: function() {
    let filters = [];

    if (this._currentButton.checked)
      filters.push({ expression: "current = 1", parameters: {} });

    // FIXME: use a left join here once the SQLite bug breaking left joins to
    // virtual tables has been fixed (i.e. after we upgrade to SQLite 3.5.7+).
    if (this._filterTextbox.value)
      filters.push({ expression: "messages.id IN (SELECT messageID FROM parts WHERE content MATCH :filter)",
                     parameters: { filter: this._filterTextbox.value } });

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

    if (this._currentButton.checked)
      params.push("current");

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
  // Event Handlers

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
    this._collection.sortOrder = -1;
    this._collection.sortProperties = ["received", "timestamp"];
    this._updateURI();
    this._applyFilters();
    // No need to rebuild the view here, as _applyFilters will do it for us.
    // XXX Should we pull the call to rebuildView out of _applyFilters?
  },


  //**************************************************************************//
  // Safe DOM Manipulation

  /**
   * Use this sandbox to run any DOM manipulation code on nodes
   * which are already inserted into the content document.
   */
  get _contentSandbox() {
    delete this._contentSandbox;
    return this._contentSandbox = new Cu.Sandbox(this._window);
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

  // FIXME: make group names localizable.
  // FIXME: move group names into the SnowlUtils module.

  // I wonder if it makes more sense to define groups in a data structure
  // that also defines the periods to which they apply and specify start/end
  // times rather than epochs (which are essentially start times).
  // Among other benefits, we could potentially eliminate unused epochs
  // like "The Future" and (in some cases) "Older" while fixing the bug
  // that epochs never reached don't appear in the view.

  // The groups into which we break up messages.  These vary by period,
  // since different periods are optimally split up into different groupings.
  _groups: {
    today: [
      { name: "The Future", epoch: Number.MAX_VALUE },
      { name: "Evening", epoch: SnowlDateUtils.evening(SnowlDateUtils.today) },
      { name: "Afternoon", epoch: SnowlDateUtils.afternoon(SnowlDateUtils.today) },
      { name: "Morning", epoch: SnowlDateUtils.morning(SnowlDateUtils.today) },
      { name: "Wee Hours", epoch: SnowlDateUtils.today },
      { name: "Older", epoch: 0 }
    ],
    yesterday: [
      { name: "The Future", epoch: Number.MAX_VALUE },
      { name: "Evening", epoch: SnowlDateUtils.evening(SnowlDateUtils.yesterday) },
      { name: "Afternoon", epoch: SnowlDateUtils.afternoon(SnowlDateUtils.yesterday) },
      { name: "Morning", epoch: SnowlDateUtils.morning(SnowlDateUtils.yesterday) },
      { name: "Wee Hours", epoch: SnowlDateUtils.yesterday },
      { name: "Older", epoch: 0 }
    ],
    last7days: [
      { name: "The Future", epoch: Number.MAX_VALUE },
      { name: "Today", epoch: SnowlDateUtils.today },
      { name: "Yesterday", epoch: SnowlDateUtils.yesterday },
      { name: SnowlDateUtils.twoDaysAgo.name, epoch: SnowlDateUtils.twoDaysAgo.epoch },
      { name: SnowlDateUtils.threeDaysAgo.name, epoch: SnowlDateUtils.threeDaysAgo.epoch },
      { name: SnowlDateUtils.fourDaysAgo.name, epoch: SnowlDateUtils.fourDaysAgo.epoch },
      { name: SnowlDateUtils.fiveDaysAgo.name, epoch: SnowlDateUtils.fiveDaysAgo.epoch },
      { name: SnowlDateUtils.sixDaysAgo.name, epoch: SnowlDateUtils.sixDaysAgo.epoch },
      { name: "Older", epoch: 0 }
    ],
    last4weeks: [
      { name: "The Future", epoch: Number.MAX_VALUE },
      { name: "Week One", epoch: SnowlDateUtils.tomorrow - (SnowlDateUtils.msInDay * 7) },
      { name: "Week Two", epoch: SnowlDateUtils.tomorrow - (SnowlDateUtils.msInDay * 14) },
      { name: "Week Three", epoch: SnowlDateUtils.tomorrow - (SnowlDateUtils.msInDay * 21) },
      { name: "Week Four", epoch: SnowlDateUtils.tomorrow - (SnowlDateUtils.msInDay * 28) },
      { name: "Older", epoch: 0 }
    ],
    all: [
      { name: "The Future", epoch: Number.MAX_VALUE },
      { name: "Today", epoch: SnowlDateUtils.today },
      { name: "Yesterday", epoch: SnowlDateUtils.yesterday },
      { name: "Older", epoch: 0 }
    ]
  },

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
    this._contentSandbox.messages = contentBox;

    let period = this._periodMenu.selectedItem ? this._periodMenu.selectedItem.value : "all";
    let groups = this._groups[period];
    let groupIndex = 0;

    for (let i = 0; i < this._collection.messages.length; ++i) {
      let message = this._collection.messages[i];

      while (message.received < groups[groupIndex].epoch) {
        ++groupIndex;

        let header = this._document.createElementNS(XUL_NS, "checkbox");
        header.className = "groupHeader";
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

        this._contentSandbox.messages = container;
      }

      let messageBox = this._document.createElementNS(HTML_NS, "div");
      messageBox.className = "message";
      messageBox.setAttribute("index", i);

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
      //  this._unsafeSetURIAttribute(source, "href", message.source.humanURI.spec);
      //bylineBox.appendChild(source);

      // Title
      title = this._document.createElementNS(HTML_NS, "h2");
      title.className = "title";
      let titleLink = this._document.createElementNS(HTML_NS, "a");
      titleLink.appendChild(this._document.createTextNode(message.subject || "untitled"));
      if (message.link)
        this._unsafeSetURIAttribute(titleLink, "href", message.link);
      title.appendChild(titleLink);

      // Body
      let bodyText = message.content || message.summary;
      if (bodyText) {
        body = this._document.createElementNS(HTML_NS, "div");
        body.className = "body";
        if (bodyText.base)
          body.setAttributeNS(XML_NS, "base", bodyText.base.spec);

        let docFragment = bodyText.createDocumentFragment(body);
        if (docFragment) {
          body.appendChild(docFragment);

          // Generate a excerpt of the message.
          // FIXME: use an actual ellipsis.
          // XXX Does an ellipsis need to be localizable?
          excerpt.appendChild(document.createTextNode(
            body.textContent.substring(0, 140) + ((body.textContent.length > 140) ? "..." : "")));

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
      messageBox.appendChild(title);
      messageBox.appendChild(excerpt);
      messageBox.appendChild(body);
      messageBox.appendChild(bylineBox);

      this._contentSandbox.messageBox = messageBox;

      let codeStr = "messages.appendChild(messageBox)";
      Cu.evalInSandbox(codeStr, this._contentSandbox);

      // Sleep after every tenth message so we don't hork the UI thread and users
      // can immediately start reading messages while we finish writing them.
      if (!(i % 10))
        yield this._sleepWriteMessages(0);
    }

    this._contentSandbox.messages = null;
    this._contentSandbox.messageBox = null;

    this._log.info("time spent building view: " + (new Date() - begin) + "ms\n");
  })

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
