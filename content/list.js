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

// FIXME: import these into an object to avoid name collisions.
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/Preferences.js");

Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/utils.js");

let SnowlMessageView = {
  // Logger
  get _log() {
    delete this._log;
    return this._log = Log4Moz.Service.getLogger("Snowl.ListView");
  },

  // Observer Service
  // FIXME: switch to using the Observers module.
  get _obsSvc() {
    delete this._obsSvc;
    return this._obsSvc = Cc["@mozilla.org/observer-service;1"].
                          getService(Ci.nsIObserverService);
  },

  // Atom Service
  get _atomSvc() {
    delete this._atomSvc;
    return this._atomSvc = Cc["@mozilla.org/atom-service;1"].
                           getService(Ci.nsIAtomService);
  },

  // The ID of the source to display.  The sidebar can set this to the source
  // selected by the user.
  // FIXME: make this an array of sources, and let the user select multiple
  // sources to view multiple sources simultaneously.
  sourceID: null,

  get _filter() {
    delete this._filter;
    return this._filter = document.getElementById("snowlFilter");
  },

  get _tree() {
    delete this._tree;
    return this._tree = document.getElementById("snowlView");
  },

  get _snowlViewContainer() {
    delete this._snowlViewContainer;
    return this._snowlViewContainer = document.getElementById("snowlViewContainer");
  },

  get _snowlViewSplitter() {
    delete this._snowlViewSplitter;
    return this._snowlViewSplitter = document.getElementById("snowlViewSplitter");
  },

  get _snowlSidebar() {
    delete this._snowlSidebar;
    return this._snowlSidebar = document.getElementById("snowlSidebar");
  },

  get _currentButton() {
    delete this._currentButton;
    return this._currentButton = document.getElementById("snowlCurrentButton");
  },

  get _unreadButton() {
    delete this._unreadButton;
    return this._unreadButton = document.getElementById("snowlUnreadButton");
  },

  // Maps XUL tree column IDs to collection properties.
  _columnProperties: {
    "snowlAuthorCol": "author",
    "snowlSubjectCol": "subject",
    "snowlTimestampCol": "timestamp"
  },


  //**************************************************************************//
  // nsITreeView

  get rowCount() {
this._log.info("get rowCount: " + this._collection.messages.length);
    return this._collection.messages.length;
  },

  getCellText: function(aRow, aColumn) {
    // FIXME: use _columnProperties instead of hardcoding column
    // IDs and property names here.
    switch(aColumn.id) {
      case "snowlAuthorCol":
        return this._collection.messages[aRow].author;
      case "snowlSubjectCol":
        return this._collection.messages[aRow].subject;
      case "snowlTimestampCol":
        return SnowlUtils._formatDate(new Date(this._collection.messages[aRow].timestamp));
      default:
        return null;
    }
  },

  _treebox: null,
  setTree: function(treebox){ this._treebox = treebox; },
  cycleHeader: function(aColumn) {},

  isContainer: function(aRow) { return false },
  isSeparator: function(aRow) { return false },
  isSorted: function() { return false },
  getLevel: function(aRow) { return 0 },
  getImageSrc: function(aRow, aColumn) { return null },
  getRowProperties: function (aRow, aProperties) {},

  getCellProperties: function (aRow, aColumn, aProperties) {
    // We have to set this on each cell rather than on the row as a whole
    // because the styling we apply to unread messages (bold text) has to be
    // specified by the ::-moz-tree-cell-text pseudo-element, which inherits
    // only the cell's properties.
    if (!this._collection.messages[aRow].read)
      aProperties.AppendElement(this._atomSvc.getAtom("unread"));
  },

  getColumnProperties: function(aColumnID, aColumn, aProperties) {},

  // We could implement inline tagging with an editable "Tags" column
  // by making this true, adding editable="true" to the tree tag, and
  // then marking only the tags column as editable.
  isEditable: function() { return false },


  //**************************************************************************//
  // Initialization and Destruction

  init: function() {
    // Move sidebar-box into our box for layouts
    let sidebarBox = document.getElementById("sidebar-box");
    this._snowlSidebar.appendChild(sidebarBox);

    // Listen for sidebar-box hidden attr change, to toggle properly
    sidebarBox.addEventListener("DOMAttrModified",
        function(aEvent) { 
          if (aEvent.target.id == "sidebar-box")
            SnowlMessageView._toggleSidebar(aEvent);
        }, false);

    // Restore previous layout view and set menuitem checked
    let mainWindow = document.getElementById("main-window");
    let layout = mainWindow.getAttribute("snowlLayout");
    // If error or first time default to 'classic' view
    let layoutIndex = this.layoutName.indexOf(layout) < 0 ? 
        0 : this.layoutName.indexOf(layout);
    this.layout(layoutIndex);
  },

  show: function() {
    this._obsSvc.addObserver(this, "messages:changed", true);

    this._collection = new SnowlCollection();
    this._sort();
    this._tree.view = this;

    this._snowlViewContainer.hidden = false;
    this._snowlViewSplitter.hidden = false;
  },

  hide: function() {
    this._snowlViewContainer.hidden = true;
    this._snowlViewSplitter.hidden = true;

    // XXX Should we somehow destroy the view here (f.e. by setting
    // this._tree.view to null)?

    this._obsSvc.removeObserver(this, "messages:changed");
  },


  //**************************************************************************//
  // Misc XPCOM Interfaces

  // nsISupports
  QueryInterface: function(aIID) {
    if (aIID.equals(Ci.nsIObserver) ||
        aIID.equals(Ci.nsISupportsWeakReference) ||
        aIID.equals(Ci.nsISupports))
      return this;
    
    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  // nsIObserver
  observe: function(subject, topic, data) {
    switch (topic) {
      case "messages:changed":
        this._onMessagesChanged();
        break;
    }
  },


  //**************************************************************************//
  // Event & Notification Handling

  _onMessagesChanged: function() {
    // FIXME: make the collection listen for message changes and invalidate
    // itself, then rebuild the view in a timeout to give the collection time
    // to do so.
    this._collection.invalidate();

    // Don't rebuild the view if the list view hasn't been made visible yet
    // (in which case the tree won't yet have a view property).
    if (this._tree.view)
      this._rebuildView();
  },

  onFilter: function() {
    this._applyFilters();
  },

  onCommandCurrentButton: function(aEvent) {
    this._applyFilters();
  },

  onCommandUnreadButton: function(aEvent) {
    // XXX Instead of rebuilding from scratch each time, when going from
    // all to unread, simply hide the ones that are read (f.e. by setting a CSS
    // class on read items and then using a CSS rule to hide them)?
    this._applyFilters();
  },

  _applyFilters: function() {
    let filters = [];

    if (this._currentButton.checked)
      filters.push({ expression: "current = 1", parameters: {} });

    if (this._unreadButton.checked)
      filters.push({ expression: "read = 0", parameters: {} });

    // FIXME: use a left join here once the SQLite bug breaking left joins to
    // virtual tables has been fixed (i.e. after we upgrade to SQLite 3.5.7+).
    if (this._filter.value)
      filters.push({ expression: "messages.id IN (SELECT messageID FROM parts WHERE content MATCH :filter)",
                     parameters: { filter: this._filter.value } });

    this._collection.filters = filters;
    this._collection.invalidate();
    this._rebuildView();
  },

  setCollection: function(collection) {
    this._collection = collection;
    this._rebuildView();
  },

  _rebuildView: function() {
    // Clear the selection before we rebuild the view, since it won't apply
    // to the new data.
    this._tree.view.selection.select(-1);

    // Since the number of rows might have changed, we rebuild the view
    // by reinitializing it instead of merely invalidating the box object
    // (which wouldn't accommodate changes to the number of rows).
    // XXX Is there a better way to do this?
    this._tree.view = this;

    // Scroll back to the top of the tree.
    this._tree.boxObject.scrollToRow(this._tree.boxObject.getFirstVisibleRow());
  },

  switchLayout: function(layout) {
    // Build the layout
    this.layout(layout);

    // Because we've moved the tree, we have to reattach the view to it,
    // or we will get the error: "this._tree.boxObject.invalidate is not
    // a function" when we switch sources.
    this._tree.view = this;
  },

  // Layout views
  kClassicLayout: 0,
  kVerticalLayout: 1,
  kWideMessageLayout: 2,
  kWideThreadLayout: 3,
  kStackedLayout: 4,
  gCurrentLayout: null,
  layoutName: ["classic", "vertical", "widemessage", "widethread", "stacked"],

  layout: function(layout) {
    let mainWindow = document.getElementById("main-window");
    let browser = document.getElementById("browser");
    let appcontent = document.getElementById("appcontent");
    let content = document.getElementById("content");
    let sidebarSplitter = document.getElementById("sidebar-splitter");
    let snowlThreadContainer = this._snowlViewContainer;
    let snowlThreadSplitter = this._snowlViewSplitter;

    let layoutThreadPaneParent = ["appcontent", "browser", "snowlSidebar", "main-window", "sidebar-box"];
    // A 'null' is an effective appendChild, code is nice and reusable..
    let layoutThreadPaneInsertBefore = [content, appcontent, null, browser, null];
    // 0=horizontal, 1=vertical for orient arrays..
    let layoutsnowlThreadSplitterOrient = [1, 0, 0, 1, 1];
    let sidebarSplitterOrient = [0, 0, 1, 0, 0];
    let layoutSnowlBoxFlex = [0, 1, 1, 0, 0];

    var desiredParent = document.getElementById(layoutThreadPaneParent[layout]);
    if (snowlThreadContainer.parentNode.id != desiredParent.id) {
      switch (layout) {
        case this.kClassicLayout:
        case this.kVerticalLayout:
        case this.kWideThreadLayout:
          desiredParent.insertBefore(snowlThreadContainer, layoutThreadPaneInsertBefore[layout]);
          desiredParent.insertBefore(snowlThreadSplitter, layoutThreadPaneInsertBefore[layout]);
          break;
        case this.kStackedLayout:
        case this.kWideMessageLayout:
          desiredParent.insertBefore(snowlThreadSplitter, layoutThreadPaneInsertBefore[layout]);
          desiredParent.insertBefore(snowlThreadContainer, layoutThreadPaneInsertBefore[layout]);
          break;
      }
    }

    // Adjust orient and flex for all layouts
    browser.orient = sidebarSplitterOrient[layout] ? "vertical" : "horizontal";
    snowlThreadSplitter.orient = layoutsnowlThreadSplitterOrient[layout] ? "vertical" : "horizontal";
    sidebarSplitter.orient = sidebarSplitterOrient[layout] ? "vertical" : "horizontal";
    snowlThreadContainer.setAttribute("flex", layoutSnowlBoxFlex[layout]);

    // Store the layout
    mainWindow.setAttribute("snowlLayout", this.layoutName[layout]);
    this.gCurrentLayout = layout;
  },

  onSelect: function(aEvent) {
    if (this._tree.currentIndex == -1)
      return;

    // When we support opening multiple links in the background,
    // perhaps use this code:
    // http://lxr.mozilla.org/mozilla/source/browser/base/content/browser.js#1482

    let row = this._tree.currentIndex;
    let message = this._collection.messages[row];

    //window.loadURI(message.link, null, null, false);
    let url = "chrome://snowl/content/message/message.xul?id=" + message.id;
    window.loadURI(url, null, null, false);

    this._setRead(true);
  },

  onKeyPress: function(aEvent) {
    if (aEvent.altKey || aEvent.metaKey || aEvent.ctrlKey)
      return;

    // which is either the charCode or the keyCode, depending on which is set.
    this._log.info("onKeyPress: which = " + aEvent.which);

    if (aEvent.charCode == "r".charCodeAt(0))
      this._toggleRead(false);
    if (aEvent.charCode == "R".charCodeAt(0))
      this._toggleRead(true);
    else if (aEvent.charCode == " ".charCodeAt(0))
      this._onSpacePress(aEvent);
  },

  // Based on SpaceHit in mailWindowOverlay.js
  _onSpacePress: function(aEvent) {
    if (aEvent.shiftKey) {
      // if at the start of the message, go to the previous one
      if (gBrowser.contentWindow.scrollY > 0)
        gBrowser.contentWindow.scrollByPages(-1);
      else
        this._goToPreviousUnreadMessage();
    }
    else {
      // if at the end of the message, go to the next one
      if (gBrowser.contentWindow.scrollY < gBrowser.contentWindow.scrollMaxY)
        gBrowser.contentWindow.scrollByPages(1);
      else
        this._goToNextUnreadMessage();
    }
  },

  _goToPreviousUnreadMessage: function() {
    let currentIndex = this._tree.currentIndex;
    let i = currentIndex - 1;

    while (i != currentIndex) {
      if (i < 0) {
        i = this._collection.messages.length - 1;
        continue;
      }

      if (!this._collection.messages[i].read) {
        this.selection.select(i);
        this._tree.treeBoxObject.ensureRowIsVisible(i);
        break;
      }

      i--;
    }
  },

  _goToNextUnreadMessage: function() {
    let currentIndex = this._tree.currentIndex;
    let i = currentIndex + 1;

    while (i != currentIndex) {
      if (i > this._collection.messages.length - 1) {
        i = 0;
        continue;
      }
this._log.info(i);
      if (!this._collection.messages[i].read) {
        this.selection.select(i);
        this._tree.treeBoxObject.ensureRowIsVisible(i);
        break;
      }

      i++;
    }
  },

  _toggleRead: function(aAll) {
this._log.info("_toggleRead: all? " + aAll);
    if (this._tree.currentIndex == -1)
      return;

    let row = this._tree.currentIndex;
    let message = this._collection.messages[row];
    if (aAll)
      this._setAllRead(!message.read);
    else
      this._setRead(!message.read);
  },

  _setRead: function(aRead) {
    let row = this._tree.currentIndex;
    let message = this._collection.messages[row];
    message.read = aRead;
    this._tree.boxObject.invalidateRow(row);
  },

  _setAllRead: function(aRead) {
    let ids = this._collection.messages.map(function(v) { return v.id });
    this._collection.messages.forEach(function(v) { v.read = aRead });
    this._tree.boxObject.invalidate();
  },

  // Functions to handle proper display of sidebar since a parent node has
  // been added to sidebar to make the extra layouts (widemessage) possible.
  show_snowlSidebar: function() {
    let snowlSidebar = this._snowlSidebar;
    snowlSidebar.height = snowlSidebar.getAttribute("heightSnowlLayouts");
    snowlSidebar.width = snowlSidebar.getAttribute("widthSnowlLayouts");
  },

  hide_snowlSidebar: function() {
    let snowlSidebar = this._snowlSidebar;
    snowlSidebar.setAttribute("heightSnowlLayouts", snowlSidebar.height);
    snowlSidebar.height = 0;
    snowlSidebar.setAttribute("widthSnowlLayouts", snowlSidebar.width);
    snowlSidebar.width = 0;
  },

  _toggleSidebar: function(aEvent) {
    if (aEvent.attrName == "hidden") {
      if (aEvent.newValue == "true")
        this.hide_snowlSidebar();
      else
        this.show_snowlSidebar();
    }
  },

  onClickColumnHeader: function(aEvent) {
    let column = aEvent.target;
    let property = this._columnProperties[column.id];
    let sortResource = this._tree.getAttribute("sortResource");
    let sortDirection = this._tree.getAttribute("sortDirection");

    // FIXME: don't sort if the user right- or middle-clicked the header.

    // Determine the sort order.  If the user clicked on the header for
    // the current sort column, we sort in the reverse of the current order.
    // Otherwise we sort in ascending order.
    let oldOrder = (sortDirection == "ascending" ? 1 : -1);
    let newOrder = (column.id == sortResource ? -oldOrder : 1);

    // Persist the new sort resource and direction.
    let direction = (newOrder == 1 ? "ascending" : "descending");
    this._tree.setAttribute("sortResource", column.id);
    this._tree.setAttribute("sortDirection", direction);

    // Update the sort indicator to appear on the current column.
    let columns = this._tree.getElementsByTagName("treecol");
    for (let i = 0; i < columns.length; i++)
      columns[i].removeAttribute("sortDirection");
    column.setAttribute("sortDirection", direction);

    // Perform the sort.
    this._sort();
  },

  _sort: function() {
    let resource = this._tree.getAttribute("sortResource");
    let property = this._columnProperties[resource];

    let direction = this._tree.getAttribute("sortDirection");
    let order = (direction == "ascending" ? 1 : -1);

    // Perform the sort.
    this._collection.sortProperties = [property];
    this._collection.sortOrder = order;
    this._collection.sort();
  }
};

window.addEventListener("load", function() { SnowlMessageView.init() }, false);
