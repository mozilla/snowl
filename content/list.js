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

// FIXME: import modules into an object to avoid name collisions, since this
// script gets loaded into the main browser window context.

// modules that come with Firefox

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/Preferences.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/utils.js");

let strings = new StringBundle("chrome://snowl/locale/message.properties");

let SnowlMessageView = {
  // Logger
  get _log() {
    delete this._log;
    return this._log = Log4Moz.repository.getLogger("Snowl.ListView");
  },

  // Atom Service
  get _atomSvc() {
    delete this._atomSvc;
    return this._atomSvc = Cc["@mozilla.org/atom-service;1"].
                           getService(Ci.nsIAtomService);
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

  get _sidebarBox() {
    delete this._sidebarBox;
    return this._sidebarBox = document.getElementById("sidebar-box");
  },

  get _snowlUnDeleteMessagesMenuitem() {
    delete this._snowlUnDeleteMessagesMenuitem;
    return this._snowlUnDeleteMessagesMenuitem =
        document.getElementById("snowlUnDeleteMessagesMenuitem");
  },

  get CollectionsView() {
    delete this._CollectionsView;
    return this._CollectionsView = document.getElementById("sidebar").
                                            contentWindow.CollectionsView;
  },

  // Maps XUL tree column IDs to collection message object properties for sorting.
  _columnProperties: {
    "snowlSourceCol": "source.name",
    "snowlAuthorCol": "author.person.name",
    "snowlSubjectCol": "subject",
    "snowlTimestampCol": "timestamp",
    "snowlDateReceivedCol": "received",
    "snowlReadCol": "read",
    "snowlFlaggedCol": "attributes.flagged"
  },

  Filters: {},

  MESSAGE_URI: "chrome://snowl/content/message.xhtml?id=",


  //**************************************************************************//
  // nsITreeView

  _treebox: null,
  setTree: function(treebox){ this._treebox = treebox; },

  get rowCount() {
//this._log.info("get rowCount: " + this._collection.messages.length);
    return this._collection.messages.length;
  },

  getCellText: function(aRow, aColumn) {
    // FIXME: use _columnProperties instead of hardcoding column
    // IDs and property names here.
    switch(aColumn.id) {
      case "snowlSourceCol":
        return this._collection.messages[aRow].source.name;

      case "snowlAuthorCol":
        return this._collection.messages[aRow].author ?
               this._collection.messages[aRow].author.person.name : null;

      case "snowlSubjectCol":
        return this._collection.messages[aRow].subject ||
               this._collection.messages[aRow].excerpt;

      case "snowlTimestampCol":
        return SnowlDateUtils._formatDate(this._collection.messages[aRow].timestamp);

      case "snowlDateReceivedCol":
        return SnowlDateUtils._formatDate(this._collection.messages[aRow].received);

      default:
        return null;
    }
  },

  getCellProperties: function (aRow, aColumn, aProperties) {
    // We have to set this on each cell rather than on the row as a whole
    // because the text styling we apply to unread/deleted messages has to be
    // specified by the ::-moz-tree-cell-text pseudo-element, which inherits
    // only the cell's properties.
    if (this._collection.messages[aRow].read == MESSAGE_UNREAD ||
        this._collection.messages[aRow].read == MESSAGE_NEW)
      aProperties.AppendElement(this._atomSvc.getAtom("unread"));

    if (aColumn.id == "snowlSubjectCol" &&
        this._collection.messages[aRow].read == MESSAGE_NEW)
      aProperties.AppendElement(this._atomSvc.getAtom("new"));

    if (this._collection.messages[aRow].current == MESSAGE_NON_CURRENT_DELETED ||
        this._collection.messages[aRow].current == MESSAGE_CURRENT_DELETED)
      aProperties.AppendElement(this._atomSvc.getAtom("deleted"));

    if (aColumn.id == "snowlFlaggedCol" &&
        this._collection.messages[aRow].attributes.flagged)
      aProperties.AppendElement(this._atomSvc.getAtom("flagged"));

    this.getColumnProperties(aColumn, aProperties);
  },

  getColumnProperties: function(aColumn, aProperties) {
    aProperties.AppendElement(this._atomSvc.getAtom("col-" + aColumn.id));
  },

  cycleCell: function(aRow, aColumn) {
    if (aColumn.id == "snowlFlaggedCol")
      this._setFlagged(aRow);
    if (aColumn.id == "snowlReadCol") {
      let read = this._collection.messages[aRow].read;
      this._collection.messages[aRow].read = (read == MESSAGE_UNREAD ||
                                              read == MESSAGE_NEW) ?
                                              MESSAGE_READ : MESSAGE_UNREAD;
      this._collection.messages[aRow].persist();
    }
  },

  cycleHeader: function(aColumn) {},
  isContainer: function(aRow) { return false },
  isSeparator: function(aRow) { return false },
  isSorted: function() { return false },
  getLevel: function(aRow) { return 0 },
  getImageSrc: function(aRow, aColumn) { return null },
  getRowProperties: function (aRow, aProperties) {},
  // We could implement inline tagging with an editable "Tags" column
  // by making this true, adding editable="true" to the tree tag, and
  // then marking only the tags column as editable.
  isEditable: function() { return false },
  canDrop: function(aRow, aOrientation) { return false },


  //**************************************************************************//
  // Initialization and Destruction

  init: function() {
    // Move sidebar-box into our box for layouts
    this._snowlSidebar.appendChild(this._sidebarBox);
    this._snowlSidebar.hidden = (this._sidebarBox.hidden || this._sidebarBox.collapsed);

    // Save position of sidebar/splitter (for wide message layout change)
    let sidebarSplitter = document.getElementById("sidebar-splitter");
    this.gSidebarSplitterSiblingID = sidebarSplitter.nextSibling.id;

    // Listen for sidebar-box hidden attr change, to toggle properly. For AiOS
    // collapse vs. unload sidebar compatibility, hide list rather than unload.
    this._sidebarBox.addEventListener("DOMAttrModified",
        function(aEvent) { 
          if (aEvent.target.id == "sidebar-box")
            if (aEvent.attrName == "hidden" || aEvent.attrName == "collapsed")
              SnowlMessageView._snowlSidebar.hidden = (aEvent.newValue == "true");
            if (aEvent.attrName == "sidebarcommand")
              SnowlMessageView.show(aEvent.newValue == "viewSnowlList");
        }, false);

    // Restore previous layout, if error or first time default to 'classic' view
    let layout = Snowl._mainWindow.getAttribute("snowllayout");
    let layoutIndex = Snowl.layoutName.indexOf(layout) < 0 ?
        this.kClassicLayout : Snowl.layoutName.indexOf(layout);
    this.layout(layoutIndex);

    // Init list with empty collection.
    this._collection = new SnowlCollection();
    this._collection.clear();
    this._tree.view = this;
  },

  show: function(aShow) {
    this._snowlViewContainer.hidden = !aShow;
    this._snowlViewSplitter.hidden = !aShow;

    // XXX Should we somehow destroy the view here (f.e. by setting
    // this._tree.view to null) if aShow is false?
  },


  //**************************************************************************//
  // Event & Notification Handling

  onMessageAdded: function(message) {
    // Refresh list view on each new message, if collection selected.
//this._log.info("onMessageAdded: REFRESH LIST");
    if (this.Filters["searchterms"] &&
        this.CollectionsView._searchFilter.getAttribute("searchtype") == "messages")
      // If in message search, redo the search in case a new message matches.
      this._applyFilters();
    else {
      this._collection.messages.push(message);
      this._rebuildView();
    }
  },

  onFilter: function(aFilters) {
    this.Filters = aFilters;
    this._applyFilters();
  },

  _applyFilters: function() {
    let filters = [];
//this._log.info("_applyFilters: Filters - "+this.Filters.toSource());

    if (this.Filters["unread"])
      filters.push({ expression: "(read = " + MESSAGE_UNREAD + " OR" +
                                 " read = " + MESSAGE_NEW + ")",
                     parameters: {} });

    if (this.Filters["flagged"])
      filters.push({ expression: "(messages.attributes REGEXP :regexp)",
                     parameters: { regexp: '"flagged":true'} });

    if (this.Filters["deleted"])
      filters.push({ expression: "(current = " + MESSAGE_NON_CURRENT_DELETED + " OR" +
                                 " current = " + MESSAGE_CURRENT_DELETED + ")",
                     parameters: {} });
    else
      filters.push({ expression: "(current = " + MESSAGE_NON_CURRENT + " OR" +
                                 " current = " + MESSAGE_CURRENT + ")",
                     parameters: {} });

    // FIXME: use a left join here once the SQLite bug breaking left joins to
    // virtual tables has been fixed (i.e. after we upgrade to SQLite 3.5.7+).
    if (this.Filters["searchterms"]) {
      filters.push({ expression: "messages.id IN " +
                                 "(SELECT messageID FROM parts" +
                                 " JOIN partsText ON parts.id = partsText.docid" +
                                 " WHERE partsText.content MATCH :filter)",
                     parameters: { filter: this.Filters["searchterms"] } });
    }

    this._collection.filters = filters;
    this._collection.invalidate();
    this._rebuildView();
  },

  setCollection: function(collection, aFilters) {
    this._collection = collection;
    this.Filters = aFilters;
    this._applyFilters();
  },

  _rebuildView: function() {
//this._log.info("_rebuildView: START ");
    // Clear the selection before we rebuild the view, since it won't apply
    // to the new data; clearSelection() sets count to 0.
    this._tree.view.selection.select(-1);
    this._tree.view.selection.clearSelection();

    // Since the number of rows might have changed, we rebuild the view
    // by reinitializing it instead of merely invalidating the box object
    // (which wouldn't accommodate changes to the number of rows).
    // XXX Is there a better way to do this?
    // this._tree.view = this; <- doesn't work for all DOM moves..
    this._tree.boxObject.QueryInterface(Ci.nsITreeBoxObject).view = this;

    this._sort();

    if (this.Filters["searchterms"])
      if (this._collection.messages[0])
        // Select first item when searching.
        this._tree.view.selection.select(0);
      else
        this._collection._messages = [];

    // Scroll back to the top of the tree.
    // XXX: need to preserve selection.
//    this._tree.boxObject.scrollToRow(this._tree.boxObject.getFirstVisibleRow());
  },

  switchLayout: function(layout) {
    // Build the layout
    this.layout(layout);

    // Because we've moved the tree, we have to reattach the view to it,
    // or we will get the error: "this._tree.boxObject.invalidate is not
    // a function" when we switch sources.
    this._tree.boxObject.QueryInterface(Ci.nsITreeBoxObject).view = this;
  },

  // Layout views
  kClassicLayout: 0,
  kVerticalLayout: 1,
  kWideMessageLayout: 2,
  kWideThreadLayout: 3,
  kStackedLayout: 4,
  gCurrentLayout: null,
  gSidebarSplitterSiblingID: null,

  layout: function(layout) {
    if (layout == this.gCurrentLayout)
      return;

    let browser = document.getElementById("browser");
    let appcontent = document.getElementById("appcontent");
    let content = document.getElementById("content");
    let sidebarSplitter = document.getElementById("sidebar-splitter");
    let snowlSidebar = this._snowlSidebar;
    let snowlThreadContainer = this._snowlViewContainer;
    let snowlThreadSplitter = this._snowlViewSplitter;

    let layoutThreadPaneParent = ["appcontent",
                                  "browser",
                                  "snowlSidebar",
                                  "main-window",
                                  "sidebar-box"];
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
        case this.kStackedLayout:
          // Restore sidebar if coming from wide mess
          if (this.gCurrentLayout == this.kWideMessageLayout) {
            browser.insertBefore(snowlSidebar,
                document.getElementById(this.gSidebarSplitterSiblingID));
            browser.insertBefore(sidebarSplitter,
                document.getElementById(this.gSidebarSplitterSiblingID));
          }
          if (layout == this.kStackedLayout)
            desiredParent.insertBefore(snowlThreadSplitter,
                layoutThreadPaneInsertBefore[layout]);
            desiredParent.insertBefore(snowlThreadContainer,
                layoutThreadPaneInsertBefore[layout]);
          if (layout != this.kStackedLayout)
            desiredParent.insertBefore(snowlThreadSplitter,
                layoutThreadPaneInsertBefore[layout]);
          break;

        case this.kWideMessageLayout:
          // Move sidebar for wide mess
          Snowl._mainWindow.insertBefore(snowlSidebar, browser);
          Snowl._mainWindow.insertBefore(sidebarSplitter, browser);

          desiredParent.insertBefore(snowlThreadSplitter,
              layoutThreadPaneInsertBefore[layout]);
          desiredParent.insertBefore(snowlThreadContainer,
              layoutThreadPaneInsertBefore[layout]);
          break;
      }
    }

    // Adjust orient and flex for all layouts
    snowlThreadSplitter.orient = layoutsnowlThreadSplitterOrient[layout] ?
        "vertical" : "horizontal";
    sidebarSplitter.orient = sidebarSplitterOrient[layout] ?
        "vertical" : "horizontal";
    snowlThreadContainer.setAttribute("flex", layoutSnowlBoxFlex[layout]);

    // Store the layout
    Snowl._mainWindow.setAttribute("snowllayout", Snowl.layoutName[layout]);
    this.gCurrentLayout = layout;
  },

  onSelect: function(aEvent) {
//this._log.info("onSelect - start: currentIndex = "+this._tree.currentIndex);
    if (this._tree.currentIndex == -1 || SnowlUtils.gRightMouseButtonDown)
      return;

    // When we support opening multiple links in the background,
    // perhaps use this code:
    // http://lxr.mozilla.org/mozilla/source/browser/base/content/browser.js#1482

    let row = this._tree.currentIndex;
    let message = this._collection.messages[row];

    //window.loadURI(message.link, null, null, false);
    let url = this.MESSAGE_URI + message.id;
    window.loadURI(url, null, null, false);

    // On conversion of list tree to places, this will be stored in
    // currentSelectedIndex as for collections tree..
//    SnowlUtils.gListViewListIndex = row;

    if (message.read == MESSAGE_UNREAD || message.read == MESSAGE_NEW)
      this._setRead(true);

    // If new message selected, reset for toggle
    SnowlUtils.gMessagePosition.pageIndex = null;
  },

  onCollectionsDeselect: function() {
    this._collection.clear();
    this._rebuildView();
  },

  onKeyPress: function(aEvent) {
    if (aEvent.altKey || aEvent.metaKey || aEvent.ctrlKey)
      return;

    // |which| is either the charCode or the keyCode, depending on which is set.
//    this._log.info("onKeyPress: which = " + aEvent.which);

    if (aEvent.charCode == strings.get("messageMarkRead").charCodeAt(0))
      this._toggleRead(false);
    else if (aEvent.charCode == strings.get("messageMarkAllRead").charCodeAt(0))
      this._toggleRead(true);
    else if (aEvent.charCode == strings.get("messageMarkFlagged").charCodeAt(0))
      this._toggleFlagged(false);
//    else if (aEvent.charCode == strings.get("messageMarkAllFlagged").charCodeAt(0))
//      this._toggleFlagged(true);
    else if (aEvent.charCode == strings.get("messageDelete").charCodeAt(0))
      this.onDeleteMessages(false);
    else if (aEvent.charCode == strings.get("messageUndelete").charCodeAt(0) &&
        this.Filters["deleted"])
      this.onUnDeleteMessages();
    else if (aEvent.charCode == " ".charCodeAt(0))
      this._onSpacePress(aEvent);
    else if (aEvent.keyCode == "13")
      this._openListMessage(aEvent);
  },

  onClick: function(aEvent) {
    // Only for left click, button = 0..
    if (aEvent.button != 0)
      return;

    // Figure out what cell the click was in
    let row = {}, col = {}, child = {};
    this._tree.treeBoxObject.getCellAt(aEvent.clientX, aEvent.clientY, row, col, child);
    if (row.value == -1)
      return;

    // If the cell is in a "cycler" column or if the user double clicked on
    // the twisty, don't open the message in a new window
    if (aEvent.detail == 2 && !col.value.cycler && (child.value != "twisty")) {
      this._listDoubleClick();
      // Double clicking should not toggle the open / close state of the 
      // thread.  This will happen if we don't prevent the event from
      // bubbling to the default handler in tree.xml
      aEvent.stopPropagation();
    }
  },

  // Based on SpaceHit in mailWindowOverlay.js
  _onSpacePress: function(aEvent) {
    if (aEvent.shiftKey) {
      // If at the start of the message, go to the previous one.
      if (gBrowser.contentWindow.scrollY > 0)
        gBrowser.contentWindow.scrollByPages(-1);
      else
        this._goToPreviousUnreadMessage();
    }
    else {
      // If at the end of the message, go to the next one.
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

      if (this._collection.messages[i].read != MESSAGE_READ) {
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

      if (this._collection.messages[i].read != MESSAGE_READ) {
        this.selection.select(i);
        this._tree.treeBoxObject.ensureRowIsVisible(i);
        break;
      }

      i++;
    }
  },

  _toggleRead: function(aAll) {
    if (this._tree.currentIndex == -1)
      return;

    let row = this._tree.currentIndex;
    let message = this._collection.messages[row];
    let readState = message.read == MESSAGE_UNREAD ? MESSAGE_READ : MESSAGE_UNREAD;

    if (aAll)
      this._setAllRead(readState);
    else
      this._setRead(readState);
  },

  _setRead: function(aRead) {
    let row = this._tree.currentIndex;
    let message = this._collection.messages[row];
    message.read = aRead;
    message.persist();
    this._tree.boxObject.invalidateRow(row);

    // It would be nicer to update just the source/author stats object for
    // this message rather than rebuild the cache from db, but would be only a
    // small saving.
    SnowlService._collectionStatsByCollectionID = null;
    this.CollectionsView._tree.treeBoxObject.invalidate();
  },

  _setAllRead: function(aRead) {
    let readState = aRead == MESSAGE_UNREAD ? MESSAGE_UNREAD : MESSAGE_READ;
    let readStateCurrent = aRead == MESSAGE_UNREAD ? MESSAGE_READ : MESSAGE_UNREAD;

    let ids = this._collection.messages.map(function(v) { return v.id });
    this._collection.messages.forEach(function(v) { v.read = readState });
    this._tree.boxObject.invalidate();

    // Use more efficient sql rather than persisting each message.
    SnowlDatastore.dbConnection.executeSimpleSQL(
        "UPDATE messages SET read = " + readState +
        " WHERE messages.id IN ( " + ids + " ) AND" +
        " (read = " + readStateCurrent + " OR read = " + MESSAGE_NEW + ")");

    SnowlService._collectionStatsByCollectionID = null;
    this.CollectionsView._tree.treeBoxObject.invalidate();
  },

  _toggleFlagged: function(aAll) {
    if (this._tree.currentIndex == -1)
      return;

    let row = this._tree.currentIndex;

//    if (aAll)
//      this._setAllFlagged(row);
//    else
    this._setFlagged(row);
  },

  _setFlagged: function(aRow) {
    this._collection.messages[aRow].attributes["flagged"] =
        !this._collection.messages[aRow].attributes["flagged"];
    this._collection.messages[aRow].persistAttributes();
    this._tree.boxObject.invalidateRow(aRow);
  },

  onClickColumnHeader: function(aEvent) {
    // Only for left click, button = 0..
    if (aEvent.button != 0)
      return;

    let column = aEvent.target;
    let sortResource = this._tree.getAttribute("sortResource");
    let sortDirection = this._tree.getAttribute("sortDirection");

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
  },

  _listDoubleClick: function() {
    // Special type?
//    if () {} else
    this._openListMessage();
  },

  // Toggle between summary and web page (feeds); use back/forward to avoid
  // slow reload, but must also reset this in case tab changes or a url is
  // loaded from address bar or link is clicked (in onblur) or another item
  // in the list is selected (in onSelect).
  _openListMessage: function(event) {
    let row = this._tree.currentIndex;
    let message = this._collection.messages[row];

    // No message or link in this message 
    if (!message || !message.link)
      return;

    if (SnowlUtils.gMessagePosition.pageIndex == --gBrowser.sessionHistory.index)
      window.BrowserBack();
    else
      if (SnowlUtils.gMessagePosition.pageIndex == gBrowser.sessionHistory.index)
        window.BrowserForward();
      else {
        SnowlUtils.gMessagePosition.tabIndex = gBrowser.tabContainer.selectedIndex;
        SnowlUtils.gMessagePosition.pageIndex =
            (++gBrowser.sessionHistory.index == gBrowser.sessionHistory.maxLength) ?
            --gBrowser.sessionHistory.index : gBrowser.sessionHistory.index;
        window.loadURI(message.link.spec, null, null, false);
      }
  },

  // Select all.
  onSelectAll: function(event) {
    this._tree.view.selection.selectAll();
  },

  onDeleteMessage: function(aMessage) {
//this._log.info("onDeleteMessage: SINGLE START");
    // Single message delete from header button.  If the message is in the list
    // due to selected collection(s), then the list is refreshed to reflect the
    // deletion.  If the message is also selected in the list, then advance the
    // selection to the next message post delete.  If the message is not in the
    // list but merely in session history, the list doesn't change.  Session
    // history is cleaned to reflect the message's deletion.
    let selectedRows = [];
    if (this._tree.currentIndex != -1 &&
        this._tree.view.selection.count != 0 &&
        this._collection.messages[this._tree.currentIndex].id == aMessage[0].id)
      selectedRows.push(this._tree.currentIndex);

    this._deleteMessages(aMessage, selectedRows);
  },

  onDeleteMessages: function(aDeleteAllShowing) {
//this._log.info("onDeleteMessages: START");
    // List context menu single/multiselection deletion of selected messages.
    // Create an array of messages and list rows to pass on.
    let messages = [], selectedRows = [];
    let rangeFirst = { }, rangeLast = { };

    if (aDeleteAllShowing)
      // Purge is requested via button.  Select the whole list.  Otherwise just
      // the selected items in the 'show deleted' list via context menu delete.
      this._tree.view.selection.selectAll();

    let numRanges = this._tree.view.selection.getRangeCount();
    for (let i = 0; i < numRanges; i++) {
      this._tree.view.selection.getRangeAt(i, rangeFirst, rangeLast);
      for (let index = rangeFirst.value; index <= rangeLast.value; index++) {
        selectedRows.push(index);
        messages.push(SnowlMessageView._collection.messages[index]);
      }
    }
//this._log.info("onDeleteMessages: selectedRows - "+selectedRows);

    this._deleteMessages(messages, selectedRows);
  },

  _deleteMessages: function(aMessages, aRows) {
//this._log.info("_deleteMessages: START #ids - "+aMessages.length);
    // Delete messages.  Delete author if deleting author's only remaining message.
    let message, messageID, current;
    let messageIDs = [], markDeletedMessageIDs = [];
    let refreshList = false, sessionHistoryEmpty = false;

    // Delete loop here, if multiple selections..
    for (let i = 0; i < aMessages.length; ++i) {
      message = aMessages[i];
      messageID = message.id;
      messageIDs.push(messageID);
      current = message.current;

      if (!SnowlMessage.retrieve(messageID)) {
//this._log.info("_deleteMessages: Delete messages NOTFOUND - "+messageID);
        continue;
      }

      if (!refreshList && (this.Filters["deleted"] ||
          this.CollectionsView.isMessageForSelectedCollection(message)))
        // Message being deleted in a selected collection?  Don't repeat call if
        // at least one is true.  Also refresh if showing deleted list.
        // XXX: is this call worth doing, based on likely deletion usage, or just
        // always refresh..
        refreshList = true;

      if (current == MESSAGE_NON_CURRENT || current == MESSAGE_CURRENT)
        markDeletedMessageIDs.push(messageID);
      else
        SnowlMessage.delete(message);
    }

    sessionHistoryEmpty = this._cleanSessionHistory(messageIDs);

    if (sessionHistoryEmpty && (!aRows || aRows.length == this._tree.view.rowCount))
      // Deleted last message in a tab; if it was non selected or all rows were
      // selected, close the tab.  However, if it was selected, then continue..
      getBrowser().removeTab(getBrowser().selectedTab);

    if (refreshList) {
      // Refresh list; if the currently deleted message is selected, then select
      // the next message (same row post refresh) or prior message (if deleted
      // message is last row).  In a multiselection, this means the row
      // of the first message in the selection.  Refresh deleted list if purged.
      let currRow, rowCount, selIndex;

      if (aRows.length > 0) {
        currRow = aRows[0];

        if (aRows.length == this._tree.view.rowCount)
          // All selected, clear list fast.
          this._collection.messages.splice(0, aRows.length);
        else {
          // Need to splice from bottom of messages array to top.
          aRows.reverse();
          aRows.forEach(function(row) {
//SnowlMessageView._log.info("_deleteMessages: splice row - "+row);
            SnowlMessageView._collection.messages.splice(row, 1);
          })
        }

        this._rebuildView();

        // Select the proper row.
        rowCount = this._tree.view.rowCount;
        selIndex = rowCount <= currRow ? --currRow : currRow;
//this._log.info("_deleteMessages: select row - "+selIndex);
        this._tree.view.selection.select(selIndex);
        this._tree.treeBoxObject.ensureRowIsVisible(selIndex);
      }
      else
        // An unselected, yet in the list, message; need to rebuild from db
        // since the row is unknown.  No selection assumed in list.
        this._applyFilters();
    }

    if (markDeletedMessageIDs.length > 0)
      SnowlMessage.markDeletedState(markDeletedMessageIDs, true);

    // Reset stats.
    SnowlService._collectionStatsByCollectionID = null;
    this.CollectionsView._tree.treeBoxObject.invalidate();
//this._log.info("_deleteMessages: END");
//this._log.info(" ");
  },

  _cleanSessionHistory: function(aMessageIDs) {
    // Remove any deleted messages from tab's session history and set the b/f
    // index to the immediate prior message.  Due to context linking, a number of
    // pages belonging to the same message may be removed upon that message's
    // deletion.  Return true if last message in history is deleted, else false.

    // XXX: clean across all tabs' history, not just current tab?
    let shEntry, uri, msgUri, msgId;
    let newCount = 0, historyChanged = false;
    let newHistory = [];

    let sh = getBrowser().webNavigation.sessionHistory;
    let currIndex = sh.index;
    let restoreIndex = currIndex;
//this._log.info("_cleanSessionHistory: messageIDs:currIndex - "+aMessageIDs+" : "+currIndex);

    for (let i = 0; i < sh.count; i++) {
      shEntry = sh.getEntryAtIndex(i, false).QueryInterface(Ci.nsISHEntry);
      uri = shEntry.URI.spec;
      msgUri = uri.split("=")[0] + "=";
      msgId = parseInt(uri.split("=")[1]);
//this._log.info("_cleanSessionHistory: Record in HISTORY - "+uri);

      if (msgUri == this.MESSAGE_URI && aMessageIDs.indexOf(msgId) != -1) {
//this._log.info("_cleanSessionHistory: Delete from HISTORY - "+uri);
        historyChanged = true;
        if (i <= currIndex)
          restoreIndex = restoreIndex <= 0 ? 0 : --restoreIndex;
        continue;
      }
//this._log.info("_cleanSessionHistory: Add to HISTORY - "+uri);

      newHistory.push(shEntry);
      newCount++;
    }

    if (!historyChanged)
      // List items deleted without any being in tab history.
      return false;

    sh.PurgeHistory(sh.count);
    sh.QueryInterface(Ci.nsISHistoryInternal);

    if (newCount == 0)
      // Only message in tab session history has been deleted.
      return true;

    newHistory.forEach(function(shEntry) {
//SnowlMessageView._log.info("_cleanSessionHistory: Restore to HISTORY - "+shEntry.URI.spec);
      sh.addEntry(shEntry, true);
    })

//this._log.info("_cleanSessionHistory: restoreIndex - "+restoreIndex);
    sh.QueryInterface(Ci.nsIWebNavigation).gotoIndex(restoreIndex);
    return false;
  },

  onUnDeleteMessages: function() {
//this._log.info("onDeleteMessages: START");
    // List context menu single/multiselection undeletion of selected messages.
    let message, messageIDs = [];
    let selectedRows = [], currRow, selIndex, rowCount;
    let rangeFirst = { }, rangeLast = { };

    let numRanges = this._tree.view.selection.getRangeCount();
    for (let i = 0; i < numRanges; i++) {
      this._tree.view.selection.getRangeAt(i, rangeFirst, rangeLast);
      for (let index = rangeFirst.value; index <= rangeLast.value; index++) {
        message = this._collection.messages[index];
        if (message.current == MESSAGE_NON_CURRENT_DELETED ||
            message.current == MESSAGE_CURRENT_DELETED) {
          messageIDs.push(message.id);
//this._log.info("onUnDeleteMessages: set undeleted - "+message.subject);
          selectedRows.push(index);
        }
      }
    }

    if (selectedRows.length > 0) {
      currRow = selectedRows[0];
//this._log.info("onUnDeleteMessages: messageIDs - "+messageIDs);
      // Need to splice from bottom of messages array to top.
      selectedRows.reverse();
      selectedRows.forEach(function(row) {
//SnowlMessageView._log.info("onUnDeleteMessages: splice row - "+row);
        SnowlMessageView._collection.messages.splice(row, 1);
      })

      this._rebuildView();

      // Select the proper row.
      rowCount = this._tree.view.rowCount;
      selIndex = rowCount <= currRow ? --currRow : currRow;
//this._log.info("_deleteMessages: select row - "+selIndex);
      this._tree.view.selection.select(selIndex);
      this._tree.treeBoxObject.ensureRowIsVisible(selIndex);
    }

    SnowlMessage.markDeletedState(messageIDs, false);

    // Reset stats.
    SnowlService._collectionStatsByCollectionID = null;
    this.CollectionsView._tree.treeBoxObject.invalidate();
  },

  onListTreeMouseDown: function(aEvent) {
//    SnowlUtils.onTreeMouseDown(aEvent, this._tree);
  },

  onTreeContextPopupHidden: function(aEvent) {
//    SnowlUtils.RestoreSelection(this._tree);
  },
 
  onTreeContextPopupShowing: function(aEvent) {
    this._snowlUnDeleteMessagesMenuitem.hidden = this.Filters["deleted"];
  }

};

window.addEventListener("load", function() { SnowlMessageView.init() }, false);
