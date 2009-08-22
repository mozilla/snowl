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

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/Preferences.js");
Cu.import("resource://snowl/modules/Sync.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/collection2.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/utils.js");

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";

let gBrowserWindow = SnowlService.gBrowserWindow;

const PREF_SELECTED_APP = "browser.feeds.handlers.application";
const PREF_SELECTED_WEB = "browser.feeds.handlers.webservice";
const PREF_SELECTED_ACTION = "browser.feeds.handler";
const PREF_SELECTED_READER = "browser.feeds.handler.default";

const PREF_VIDEO_SELECTED_APP = "browser.videoFeeds.handlers.application";
const PREF_VIDEO_SELECTED_WEB = "browser.videoFeeds.handlers.webservice";
const PREF_VIDEO_SELECTED_ACTION = "browser.videoFeeds.handler";
const PREF_VIDEO_SELECTED_READER = "browser.videoFeeds.handler.default";

const PREF_AUDIO_SELECTED_APP = "browser.audioFeeds.handlers.application";
const PREF_AUDIO_SELECTED_WEB = "browser.audioFeeds.handlers.webservice";
const PREF_AUDIO_SELECTED_ACTION = "browser.audioFeeds.handler";
const PREF_AUDIO_SELECTED_READER = "browser.audioFeeds.handler.default";

const TYPE_MAYBE_FEED = "application/vnd.mozilla.maybe.feed";
const TYPE_MAYBE_VIDEO_FEED = "application/vnd.mozilla.maybe.video.feed";
const TYPE_MAYBE_AUDIO_FEED = "application/vnd.mozilla.maybe.audio.feed";

function getPrefActionForType(t) {
  switch (t) {
    case Ci.nsIFeed.TYPE_VIDEO:
      return PREF_VIDEO_SELECTED_ACTION;

    case Ci.nsIFeed.TYPE_AUDIO:
      return PREF_AUDIO_SELECTED_ACTION;

    default:
      return PREF_SELECTED_ACTION;
  }
}

function getPrefReaderForType(t) {
  switch (t) {
    case Ci.nsIFeed.TYPE_VIDEO:
      return PREF_VIDEO_SELECTED_READER;

    case Ci.nsIFeed.TYPE_AUDIO:
      return PREF_AUDIO_SELECTED_READER;

    default:
      return PREF_SELECTED_READER;
  }
}


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

  get _periodLabel() {
    delete this._periodLabel;
    return this._periodLabel = document.getElementById("periodLabel");
  },

  _point: Date.today(),

  get _startTime() {
    // We have to create a new date from this._point to start out with
    // because some Datejs functions mutate their operand, and we don't want
    // to modify this._point in the process of deriving this value from it.
    let date = new Date(this._point);

    switch(this._periodMenu.selectedIndex) {
      case 0: // day
        return date.at("0am");
      case 1: // week
        return date.last().monday().at("0am");
      case 2: // month
        return date.set({ day: 1 }).at("0am");
      default:
        throw "unexpected period: " + this._periodMenu.selectedIndex;
    }
  },

  get _endTime() {
    // We have to create a new date from this._point to start out with
    // because some Datejs functions mutate their operand, and we don't want
    // to modify this._point in the process of deriving this value from it.
    let date = new Date(this._point);

    // To get the end of the current period, we get the beginning of
    // the next period, subtract one millisecond (which converts the date
    // into a time number representing the last millisecond of the current
    // period), and then create a new date from the number.
    switch(this._periodMenu.selectedIndex) {
      case 0: // day
        return new Date(date.next().day().at("0am") - 1);
      case 1: // week
        return new Date(date.next().monday().at("0am") - 1);
      case 2: // month
        return new Date(date.next().month().set({ day: 1 }).at("0am") - 1);
      default:
        throw "unexpected period: " + this._periodMenu.selectedIndex;
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

  get _dogmark() {
    delete this._dogmark;
    return this._dogmark = document.getElementById("dogmark");
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

    this._initWriteForm();
    this._updateWriteButton();

    // Position/size stuff relative to the initial size of the browser.
    this.onResize();

    // Listen for resize events so we can resize the content box when the size
    // of the browser changes.  We set this event listener here rather than
    // in an onresize attribute on the page element because loading this view
    // on startup can cause a resize event to fire before the view is loaded
    // (and thus before SnowlMessageView has been defined), which would cause
    // an attribute-based listener to throw an exception.
    window.addEventListener("resize",
                            function() SnowlMessageView.onResize(),
                            false);

    // Explicitly wrap |window| in an XPCNativeWrapper to make sure
    // it's a real native object! This will throw an exception if we
    // get a non-native object.
    this._window = new XPCNativeWrapper(window);
    this._document = this._window.document;

    // Init list with empty collection.
    //this._collection = new SnowlCollection();

    // Set the period to today.
    // FIXME: move this into _updateToolbar.
    this._updatePeriodLabel();

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

  /**
   * Move the dogmark to the right hand side of the browser.  We have to do this
   * programmatically on window resize because elements in stacks can't be
   * positioned relative to the right-hand side of the stack.
   * FIXME: file a bug on the missing functionality.
   */
  repositionDogmark: function() {
    this._dogmark.setAttribute("left", window.innerWidth - this._dogmark.boxObject.width);
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
    if ("body" in params) {
      this._bodyButton.checked = true;
      this._setBody(true);
    }
    else {
      this._setBody(this._bodyButton.hasAttribute("checked"));
    }

    if ("filter" in params)
      this._filter.value = params.filter;

    if ("period" in params) {
      switch(params.period) {
        case "day":
          this._periodMenu.selectedIndex = 0;
          break;
        case "week":
          this._periodMenu.selectedIndex = 1;
          break;
        case "month":
          this._periodMenu.selectedIndex = 2;
          break;
      }
    }

    if ("columns" in params) {
      this._columnsButton.checked = true;
      // XXX This feels like the wrong place to do this, but I don't see
      // a better place at the moment.  Yuck, the whole process by which
      // the view gets built needs to get cleaned up and documented.
      this._setColumns(this._columnsButton.checked);
    }
    else {
      this._setColumns(this._columnsButton.hasAttribute("checked"));
    }

    // FIXME: make this work with the new architecture.
    //if ("collection" in params) {
    //  CollectionsView.itemIds = params.collection;
    //}

    // FIXME: make this work with the new architecture.
    // Restore saved selection
//this._log.info("_updateToolbar: itemIds = "+CollectionsView.itemIds);
    //if (CollectionsView.itemIds != -1) {
    //  CollectionsView._tree.restoreSelection();
    //}
  },

  onResize: function() {
    this.resizeContentBox();
    this.repositionDogmark();
  },

  onClickDogmark: function() {
    if (this._dogmark.getAttribute("state") == "open") {
      document.getElementById("toolbar").hidden = true;
      document.getElementById("sidebar").hidden = true;
      document.getElementById("sidebarSplitter").hidden = true;
      this._dogmark.setAttribute("state", "closed");
    }
    else {
      document.getElementById("toolbar").hidden = false;
      document.getElementById("sidebar").hidden = false;
      document.getElementById("sidebarSplitter").hidden = false;
      this._dogmark.setAttribute("state", "open");
    }
  },

  onFeedRefresh: function(feed) {
    this._collection = feed.messages;
    this._rebuildView(this);
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

    filters.push({ expression: "received >= :startTime AND received < :endTime",
                   parameters: { startTime: SnowlDateUtils.jsToJulianDate(this._startTime),
                                   endTime: SnowlDateUtils.jsToJulianDate(this._endTime) } });

    this._collection.filters = filters;

    // FIXME: make this work with the new architecture.
    //if (CollectionsView.itemIds == -1)
    //  // No selection, don't show anything
    //  this._collection.clear();
    //else
    //  this._collection.invalidate();

    this._rebuildView(this);
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

  _updateURI: function() {
    let newParams = [];

    if (this._bodyButton.checked)
      newParams.push("body");

    if (this._columnsButton.checked)
      newParams.push("columns");

    // FIXME: make this work with the new architecture.
    //if (CollectionsView.itemIds && CollectionsView.itemIds != -1)
    //  newParams.push("collection=" + CollectionsView.itemIds)

    if (this._filter.value)
      newParams.push("filter=" + encodeURIComponent(this._filter.value));

    switch(this._periodMenu.selectedIndex) {
      case 0: // day
        newParams.push("period=day");
        break;
      case 1: // week
        newParams.push("period=week");
        break;
      case 2: // month
        newParams.push("period=month");
        break;
    }

    updateURI();
  },

  onSelectPeriod: function(event) {
    this._updatePeriodLabel();
    this.rebuild();
  },

  onDecrementPeriod: function(event) {
    switch(this._periodMenu.selectedIndex) {
      case 0: // day
        this._point = this._point.last().day();
        break;
      case 1: // week
        this._point = this._point.last().week();
        break;
      case 2: // month
        this._point = this._point.last().month();
        break;
    }

    this._updatePeriodLabel();
    this.rebuild();
  },

  onIncrementPeriod: function(event) {
    switch(this._periodMenu.selectedIndex) {
      case 0: // day
        this._point = this._point.next().day();
        break;
      case 1: // week
        this._point = this._point.next().week();
        break;
      case 2: // month
        this._point = this._point.next().month();
        break;
    }

    this._updatePeriodLabel();
    this.rebuild();
  },

  _updatePeriodLabel: function() {
    switch(this._periodMenu.selectedIndex) {
      case 0: // day
        this._periodLabel.setAttribute("value", this._point.toString("d"));
        break;
      case 1: // week
        // FIXME: make this localizable.
        // XXX show start and end dates instead of the week number?
        this._periodLabel.setAttribute("value", this._point.toString("yyyy") +
                                       " week " + this._point.getWeek());
        break;
      case 2: // month
        this._periodLabel.setAttribute("value", this._point.toString("y"));
        break;
    }
  },


  //**************************************************************************//
  // Event & Notification Handlers

  onLoad: function() {
    this._init();
  },

  onMessageAdded: function(message) {
this._log.info("onMessageAdded: REFRESH RIVER");
    // Don't add the message if it was received outside the period of time
    // for which the view is currently showing messages.
    if (message.received < this._startTime || message.received > this._endTime)
      return;

    // Rebuild the view instead of adding the message if the view is showing
    // a filtered set of messages, since we don't yet have code to determine
    // if the new message belongs to the filtered set.
    // FIXME: figure out a way to determine that; perhaps a message could have
    // a method that takes a filter string and returns a boolean for whether or
    // not the message content matches the string.
    if (this._filter.value) {
      this._collection.invalidate();
      this._rebuildView(this);
      return;
    }

    // Add the message to the view.
//this._log.info("onMessageAdded: REFRESH RIVER message = "+message.toSource());

    // Build the message box and prepend it to the list of messages.
    let messageBox = this._buildMessageBox(message);
    this._contentBox.insertBefore(messageBox, this._contentBox.firstChild);
  },

  onCollectionsDeselect: function() {
    this._updateURI();
    this._collection.clear();
    this._collection.constraints = null;
    this._rebuildView(this);
  },

  onMidnight: function() {
    this._setMidnightTimout();
    this._rebuildView(this);
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

  rebuild: function() {
    // Get the selected collection.
    let constraints = [];
    this._collection = Sources.getCollection(constraints);
    if (!this._collection)
      throw "can't rebuild view; no collection";

    // Apply constraints to the messages in the selection.

    // FIXME: use a left join here once the SQLite bug breaking left joins to
    // virtual tables has been fixed (i.e. after we upgrade to SQLite 3.5.7+).
    // FIXME: reimplement this using the new non-storage-specific collections model.
    //if (SnowlMessageView._filter.value) {
    //  constraints.push({ expression: "messages.id IN (SELECT messageID FROM parts JOIN partsText ON parts.id = partsText.docid WHERE partsText.content MATCH :filter)",
    //                     parameters: { filter: SnowlUtils.appendAsterisks(SnowlMessageView._filter.value) } });
    //}

    constraints.push({ name: "received", operator: ">=", value: this._startTime });
    constraints.push({ name: "received", operator: "<=", value: this._endTime });

    // Rebuild the view based on the constrained collection.
    this._rebuildView();
  },

  // The ID of the most recently started rebuild.  _rebuildView uses this
  // to stop rebuilds when new ones start.
  _rebuildID: null,

  _rebuildView: function() {
    let begin = new Date();
    let rebuildID = this._rebuildID = Cc["@mozilla.org/uuid-generator;1"].
                                      getService(Ci.nsIUUIDGenerator).
                                      generateUUID().toString();

    // Reset the view by removing all its groups and messages.
    // XXX Since contentBox is an HTML div, could we do this more quickly
    // by setting innerHTML to an empty string?
    while (this._contentBox.hasChildNodes())
      this._contentBox.removeChild(this._contentBox.lastChild);

    // Build the box for each message and add it to the view.
    let first = new Date();
    for each (let message in this._collection) {
      let before = new Date();
      let messageBox = this._buildMessageBox(message);
      this._contentBox.appendChild(messageBox);
      let after = new Date();
      let timeout = this._rebuildViewTimeout;
      this._log.trace("last: " + (after - before) + "ms; " +
                      "total: " + (after - first) + "ms; " +
                      "timeout: " + timeout + "ms");
      Sync.sleep(timeout);

      // Stop rebuilding if another rebuild started while we were sleeping.
      if (this._rebuildID != rebuildID) {
        this._log.debug(this._rebuildID + " != " + rebuildID + "; stopping rebuild");
        return;
      }
    }

    this._log.info("time spent building view: " + (new Date() - begin) + "ms\n");
  },

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
      bylineBox.appendChild(this._document.createTextNode(message.author.person.name));
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
        SnowlUtils.safelySetURIAttribute(titleLink,
                                         "href",
                                         message.link.spec,
                                         message.source.principal);
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
    if (body)
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

let Sources = {
  //**************************************************************************//
  // Shortcuts

  get _list() {
    delete this._list;
    return this._list = document.getElementById("sourcesList");
  },

  get _panel() {
    delete this._panel;
    return this._panel = document.getElementById("sourcePanel");
  },

  get _log() {
    delete this._log;
    return this._log = Log4Moz.repository.getLogger("Snowl.Sources");
  },


  //**************************************************************************//
  // Event Handlers

  onLoad: function() {
    this._rebuild();
    Observers.add("snowl:source:unstored", this.onSourceUnstored, this);
    Observers.add("snowl:message:added", this.onMessageAdded, this);
  },

  onSelect: function(event) {
    let item = this._list.selectedItem;
    // FIXME: figure out why item.label is an empty string (XUL bug?).
    this._log.info("selected item " + item.label +
                   (item.source ? " with source " +
                                  (item.source.id ? item.source.id : "")
                                : ""));

    SnowlMessageView.rebuild();
  },

  /**
   * Get the collection of messages for the currently selected source.
   *
   * FIXME: figure out how to disentangle constraints from the collection.
   */
  getCollection: function(constraints) {
    let collection;

    let item = this._list.selectedItem;

    if (!item) {
      this._log.info("can't get collection; no item selected");
    }
    else if (item.collection) {
      collection = item.collection;
      collection.constraints = constraints;
    }
    else if (item.source) {
      if (item.source.id) {
        constraints.push({ name: "source.id", operator: "==", value: item.source.id });
        collection = new StorageCollection({ constraints: constraints });
      }
      else {
        if (!item.source.messages)
          item.source.refresh();
        collection = new MessageCollection({ constraints: constraints,
                                             messages: item.source.messages });
      }
    }
    else {
      this._log.error("can't get collection; don't know how for selected item");
    }

    return collection;
  },

  onClickStarButton: function(event) {
    //alert("onClickStarButton: " + document.getBindingParent(event.originalTarget));
    let item = document.getBindingParent(event.originalTarget);
    if (!item || !item.source)
      return;

    if (item.source.id) {
      this._panelItem = item;
      this._panel.openPopup(item, "after_end");
    }
    else {
      item.source.persist();
      // Insert the item into the list of subscriptions, assuming there is
      // nothing underneath the list of subscriptions.
      // FIXME: make this more robust and less brittle against changes
      // to the collections view.
      let newItem = item.cloneNode(true);
      newItem.setAttribute("subscription", "true");
      newItem.source = item.source;
      let startIndex = this._list.getIndexOfItem(this._subscriptionsHeader) + 1;
      let itemInserted = false;
      for (let i = startIndex; i < this._list.itemCount; i++) {
        let item = this._list.getItemAtIndex(i);
        if (newItem.searchLabel.toLowerCase() < item.searchLabel.toLowerCase()) {
          this._list.insertBefore(newItem, item);
          itemInserted = true;
          break;
        }
      }
      if (!itemInserted)
        this._list.appendChild(newItem);
      this._list.selectItem(newItem);
    }
  },

  onPopupShowing: function(event) {
    //alert("onPopupShowing: " + document.getBindingParent(event.originalTarget));
  },

  onCommandUnstoreButton: function(event) {
    //alert("onCommandUnstoreButton: " + document.getBindingParent(event.target));
    //if (this._list.selectedItem && this._list.selectedItem.source)
    //  this._list.selectedItem.source.unstore();
    //this._panel.hidePopup();
    if (this._panelItem && this._panelItem.source && this._panelItem.source.id) {
      this._panelItem.source.unstore();
      this._panel.hidePopup();
    }
  },

  onSourceUnstored: function(sourceID) {
    //this._log.info("onSourceUnstored: " + sourceID);

    let startIndex = this._list.getIndexOfItem(this._subscriptionsHeader) + 1;
    for (let i = startIndex; i < this._list.itemCount; i++) {
      let item = this._list.getItemAtIndex(i);
      if (item.source && item.source.id == sourceID) {
        // Instead of removing the source from the list, merely mark it
        // as unsubscribed so the user can undo the unsubscription by clicking
        // the star button again.
        //item.setAttribute("subscription", false);
        let selected = item.selected;
        this._list.removeItemAt(i);
        if (selected) {
          // FIXME: rebuild the collection based on other selected sources
          // once multiple selection is enabled.
          SnowlMessageView._collection = [];
          SnowlMessageView._rebuildView();
        }
        break;
      }
    }
  },

  onMessageAdded: function(message) {
return;
dump("onMessageAdded: " + message + "\n");
    // Find the subscription for the message.
    let startIndex = this._list.getIndexOfItem(this._subscriptionsHeader) + 1;
    for (let i = startIndex; i < this._list.itemCount; i++) {
      let item = this._list.getItemAtIndex(i);
      if (item.source && item.source.id == message.source.id) {
        item.source.messages.unshift(message);
        if (item.selected)
          SnowlMessageView._rebuildView();
        break;
      }
    }
  },


  //**************************************************************************//
  // View Construction

  _rebuild: function() {
    let subscribedFeeds = [];
    let feedToSelect = null;
    let feedToSelectIsNew = false;

    if ("feedsToSubscribe" in params) {
      this._log.info("there are feeds to subscribe");
      let feedsToSubscribe = JSON.parse(params.feedsToSubscribe);
      let refreshTime = new Date();
      for each (let feedInfo in feedsToSubscribe) {
        this._log.info("feed to subscribe: " + feedInfo.title + ": " + feedInfo.href);

        let feed;

        if (SnowlService.hasSource(feedInfo.href)) {
          this._log.info("already subscribed; retrieving");
          let statement = SnowlDatastore.createStatement(
            "SELECT id FROM sources WHERE machineURI = :machineURI"
          );
          try {
            statement.params.machineURI = feedInfo.href;
            statement.step();
            feed = SnowlFeed.retrieve(statement.row.id);
          }
          finally {
            statement.reset();
          }
        }
        else {
          this._log.info("not yet subscribed; handling");
          feedToSelectIsNew = true;
          feed = new SnowlFeed(null, feedInfo.title, new URI(feedInfo.href), undefined, null);
          feed.refresh(refreshTime);
          if (!this._handleFeed(feed)) {
            this._log.info("not handled by other reader; subscribing");
            feed.persist();
            subscribedFeeds.push(feed);
            // Display the notification after a timeout so it doesn't immediately
            // disappear again (not sure why this is happening).
            // FIXME: investigate and find the right solution or file a bug on it.
            let t = this;
            window.setTimeout(function() t._notifySubscribe(feed), 0);
          }
        }

        // FIXME: select all "feeds to subscribe" automatically instead of just
        // the last one.
        this._log.info("setting feed to select to " + feed.id + ":" + feed.name);
        feedToSelect = feed;
      }

      delete params.feedsToSubscribe;
      updateURI();
    }

    let otherTabFeeds = this._getFeedsInOtherTabs();
    if (otherTabFeeds.length > 0) {
      let item = document.createElementNS(XUL_NS, "richlistitem");
      // FIXME: make this localizable.
      item.setAttribute("label", "Other Tabs");
      item.className = "header";
      this._list.appendChild(item);

      let sortFeedInfos = function(a, b) a.title.toLowerCase() < b.title.toLowerCase() ? -1 :
                                         a.title.toLowerCase() > b.title.toLowerCase() ?  1 : 0;
      for each (let otherTabFeed in otherTabFeeds.sort(sortFeedInfos)) {
        let feed = new SnowlFeed(null, otherTabFeed.title, new URI(otherTabFeed.href), undefined, null);
        let item = this._list.appendItem(otherTabFeed.title);
        item.searchLabel = otherTabFeed.title;
        item.source = feed;
        item.className = "source";
      }
    }

    let item = document.createElementNS(XUL_NS, "richlistitem");
    // FIXME: make this localizable.
    item.setAttribute("label", "Subscriptions");
    // FIXME: make this localizable.
    item.searchLabel = "Subscriptions";
    item.className = "header";
    item.collection = new StorageCollection();
    this._list.appendChild(item);
    this._subscriptionsHeader = item;

    let sortSources = function(a, b) a.name.toLowerCase() < b.name.toLowerCase() ? -1 :
                                     a.name.toLowerCase() > b.name.toLowerCase() ?  1 : 0;
    for each (let source in SnowlService.sources.sort(sortSources)) {
      //let item = document.createElement("richlistitem");
      let item = this._list.appendItem(source.name);
      item.searchLabel = source.name;
      item.source = source;
      item.setAttribute("subscription", "true");
      item.className = "source";
      // FIXME: select all subscribed feeds automatically instead of just one.
      if (feedToSelect && source.id) {
        this._log.info("checking if feed to select " + feedToSelect.name +
                       " (" + feedToSelect.id + ") is the same as source " +
                       source.name + " (" + source.id + ")");
        if (feedToSelect.id == source.id) {
          this._log.info("selecting feed " + feedToSelect);

          // Gross hack: make sure the newly-subscribed feed has messages.
          // FIXME: figure out why it doesn't have messages after we first
          // subscribe to it.
          if (feedToSelectIsNew)
            item.source = feedToSelect;

          this._list.selectItem(item);
        }
      }
    }
  },

  /**
   * Handle the feed according to the user's preferences.  This returns
   * a boolean indicating whether or not the feed was handled by a different
   * reader.  If so, Snowl doesn't do anything; otherwise, it subscribes
   * the feed itself and displays it to the user along with a notification
   * that lets the user choose a different feed reader.
   *
   * @see FeedConverter::handleResult, on which this is based.
   *
   * @params  feed {SnowlFeed} the feed
   * @returns {Boolean} whether or not the feed was handled by another reader
   */
  _handleFeed: function(feed) {
    var feedService = 
        Cc["@mozilla.org/browser/feeds/result-service;1"].
        getService(Ci.nsIFeedResultService);

    if (feedService.forcePreviewPage)
      return false;

    // FIXME: handle the case where there is no result.doc.

    var nsIFeed = feed.lastResult.doc.QueryInterface(Ci.nsIFeed);
    var handler = Preferences.get(getPrefActionForType(nsIFeed.type), "ask");

    if (handler == "ask")
      return false;

    if (handler == "reader")
      handler = Preferences.get(getPrefReaderForType(nsIFeed.type), "bookmarks");

    switch (handler) {
      case "web": {
        var wccr = 
            Cc["@mozilla.org/embeddor.implemented/web-content-handler-registrar;1"].
            getService(Ci.nsIWebContentConverterService);
        let handler = nsIFeed.type == Ci.nsIFeed.TYPE_FEED  ? wccr.getAutoHandler(TYPE_MAYBE_FEED)       :
                      nsIFeed.type == Ci.nsIFeed.TYPE_VIDEO ? wccr.getAutoHandler(TYPE_MAYBE_VIDEO_FEED) :
                      nsIFeed.type == Ci.nsIFeed.TYPE_AUDIO ? wccr.getAutoHandler(TYPE_MAYBE_AUDIO_FEED) :
                                                              null;
        // FIXME: handle the case where there are multiple feeds, perhaps by
        // opening them in tabs?  Or maybe there's a way to pass multiple feeds
        // to feed readers in a single request?
        if (handler)
          window.location.href = handler.getHandlerURI(feed.machineURI.spec);
        break;
      }

      default:
        this._log.info("unexpected handler: " + handler);
        // fall through -- let feed service handle error

      case "bookmarks":
      case "client":
        try {
          feedService.addToClientReader(feed.machineURI.spec, feed.name, feed.subtitle, nsIFeed.type);
        }
        catch(ex) {
          this._log.error("feedService.addToClientReader failed: " + ex);
          return false;
        }
    }

    return true;
  },

  _getFeedsInOtherTabs: function() {
    // I would use FUEL here, but its tab API doesn't provide access to feeds.

    let tabBrowser = gBrowserWindow.gBrowser;
    let tabs = tabBrowser.mTabs;
    let pages = [];
    for (let i = 0; i < tabs.length; i++) {
      let tab = tabs[i];
      let browser = tabBrowser.getBrowserForTab(tab);
      if (browser.feeds)
        pages.push({ feeds: browser.feeds, title: browser.contentTitle });
    }

    return SnowlUtils.canonicalizeFeedsFromMultiplePages(pages);
  },

  _notifySubscribe: function(feed) {
    let notificationBox = gBrowserWindow.getNotificationBox(window);
    let notification = notificationBox.appendNotification(
      // FIXME: localize it.
      "You've subscribed to " + feed.name + " in Snowl!",
      "snowlSubscribeFeed",
      "chrome://snowl/content/icons/snowl-16.png",
      notificationBox.PRIORITY_INFO_MEDIUM,
      null
    );
    notification.init(feed, window);
  }

};

window.addEventListener("load", function() Sources.onLoad(), false);

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

// FIXME: modularize this.
let params = {};
{
  let query = window.location.search.substr(1);
  for each (let param in query.split("&")) {
    let name, value;
    if (param.indexOf("=") != -1) {
      [name, value] = param.split("=");
      value = decodeURIComponent(value);
    }
    else
      name = param;
    // FIXME: make this support multiple same-named params
    // (put them into an array?).
    params[name] = value;
  }
}

function updateURI() {
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
  if (historyEntry instanceof Ci.nsISHEntry) {
    historyEntry.setURI(uri);
  }
  else {
    dump("can't update session history URI for " +
         "'" + historyEntry.title + "' " +
         "<" + historyEntry.URI.spec + ">; " +
         "entry is not an instance of nsISHEntry\n");
  }
}
