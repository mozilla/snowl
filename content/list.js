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
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/utils.js");

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

  // Maps XUL tree column IDs to collection properties.
  _columnProperties: {
    "snowlSourceCol": "source",
    "snowlAuthorCol": "authorName",
    "snowlSubjectCol": "subject",
    "snowlTimestampCol": "timestamp"
  },

  MESSAGE_URI: "chrome://snowl/content/message.xhtml?id=",


  //**************************************************************************//
  // nsITreeView

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
        return this._collection.messages[aRow].author.name;

      case "snowlSubjectCol":
        return this._collection.messages[aRow].subject ||
               this._collection.messages[aRow].excerpt;

      case "snowlTimestampCol":
        return SnowlDateUtils._formatDate(this._collection.messages[aRow].timestamp);

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

    // Save position of sidebar/splitter (for wide message layout change)
    let sidebarSplitter = document.getElementById("sidebar-splitter");
    this.gSidebarSplitterSiblingID = sidebarSplitter.nextSibling.id;

    // Listen for sidebar-box hidden attr change, to toggle properly
    sidebarBox.addEventListener("DOMAttrModified",
        function(aEvent) { 
          if (aEvent.target.id == "sidebar-box" && aEvent.attrName == "hidden")
            SnowlMessageView._snowlSidebar.hidden = (aEvent.newValue == "true");
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

  show: function() {
    this._snowlViewContainer.hidden = false;
    this._snowlViewSplitter.hidden = false;

    Snowl._initSnowlToolbar();
  },

  hide: function() {
    this._snowlViewContainer.hidden = true;
    this._snowlViewSplitter.hidden = true;

    // XXX Should we somehow destroy the view here (f.e. by setting
    // this._tree.view to null)?
  },


  //**************************************************************************//
  // Event & Notification Handling

  onMessageAdded: function(message) {
    // Refresh list view on each new message, if collection selected.
//this._log.info("onMessageAdded: REFRESH LIST");
    this._collection.messages.push(message);
    this._rebuildView();
  },

  onFilter: function(aFilters) {
    this._applyFilters(aFilters);
  },

  _applyFilters: function(aFilters) {
    let filters = [];
//this._log.info("_applyFilters: aFilters - "+[aFilters].toSource());

    if (aFilters["unread"])
      filters.push({ expression: "read = 0", parameters: {} });

    // FIXME: use a left join here once the SQLite bug breaking left joins to
    // virtual tables has been fixed (i.e. after we upgrade to SQLite 3.5.7+).
    if (aFilters["searchterms"])
      filters.push({ expression: "messages.id IN " +
                                 "(SELECT messageID FROM parts " +
                                 "JOIN partsText ON parts.id = partsText.docid " +
                                 "WHERE partsText.content MATCH :filter)",
                     parameters: { filter: SnowlUtils.appendAsterisks(
                                             aFilters["searchterms"]) } });

    this._collection.filters = filters;
    this._collection.invalidate();
    this._rebuildView();
  },

  setCollection: function(collection, aFilters) {
    this._collection = collection;
    this._applyFilters(aFilters);
  },

  _rebuildView: function() {
    // Clear the selection before we rebuild the view, since it won't apply
    // to the new data.
    this._tree.view.selection.select(-1);

    // Since the number of rows might have changed, we rebuild the view
    // by reinitializing it instead of merely invalidating the box object
    // (which wouldn't accommodate changes to the number of rows).
    // XXX Is there a better way to do this?
    // this._tree.view = this; <- doesn't work for all DOM moves..
    this._tree.boxObject.QueryInterface(Ci.nsITreeBoxObject).view = this;

    this._sort();

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

    // which is either the charCode or the keyCode, depending on which is set.
//    this._log.info("onKeyPress: which = " + aEvent.which);

    if (aEvent.charCode == "r".charCodeAt(0))
      this._toggleRead(false);
    if (aEvent.charCode == "R".charCodeAt(0))
      this._toggleRead(true);
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
    message.persist();
    this._tree.boxObject.invalidateRow(row);
  },

  _setAllRead: function(aRead) {
    let ids = this._collection.messages.map(function(v) { return v.id });
    this._collection.messages.forEach(function(v) { v.read = aRead; v.persist(); });
    this._tree.boxObject.invalidate();
  },

  onClickColumnHeader: function(aEvent) {
    // Only for left click, button = 0..
    if (aEvent.button != 0)
      return;

    let column = aEvent.target;
    let property = this._columnProperties[column.id];
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
        window.loadURI(message.link, null, null, false);
      }
  },

  onDeleteMessages: function() {
//this._log.info("onDeleteMessages: START ids - ");
    // Create an array of selected messages.
  },

  _deleteMessages: function(aMessages) {
//this._log.info("_deleteMessages: START #ids - "+aMessages.length);
    // Delete messages.  Remove author if a deleted message is the only one left.

    // Delete loop here, if multiple selections..
    let message, messageID, authorID, messageIDs = [];
    for (let i = 0; i < aMessages.length; ++i) {
      message = aMessages[i];
      messageID = message.id;
      messageIDs.push(messageID)
      authorID = message.authorID;
      authorPlaceID = message.author.placeID;

      if (!SnowlMessage.get(messageID)) {
//this._log.info("_deleteMessages: Delete messages NOTFOUND - "+messageID);
        continue;
      }

      SnowlDatastore.dbConnection.beginTransaction();
      try {
        // Delete messages
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM metadata " +
            "WHERE messageID = " + messageID);
//this._log.info("_deleteMessages: Delete messages METADATA DONE");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM partsText " +
            "WHERE docid IN " +
            "(SELECT id FROM parts WHERE messageID = " + messageID + ")");
//this._log.info("_deleteMessages: Delete messages PARTSTEXT DONE");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM parts " +
            "WHERE messageID  = " + messageID);
//this._log.info("_deleteMessages: Delete messages PARTS DONE");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM messages " +
            "WHERE id = " + messageID);
//this._log.info("_deleteMessages: Delete messages DONE");
        if (!SnowlService.hasAuthorMessage(authorID)) {
          // Delete people/identities; author's only message has been deleted.
          SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM people " +
              "WHERE id IN " +
              "(SELECT personID FROM identities WHERE id = " + authorID + ")");
          SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM identities " +
              "WHERE id = " + authorID);
          // Finally, clean up Places bookmark by author's placeID.
        PlacesUtils.bookmarks.removeItem(authorPlaceID);
//this._log.info("_deleteMessages: Delete DONE authorID - "+authorID);
        }
//        PlacesUtils.history.removePage(URI(this.MESSAGE_URI + messageID));
//        PlacesUtils.history.hidePage(URI(this.MESSAGE_URI + messageID));
//this._log.info("_deleteMessages: Delete DONE messageID - "+messageID);

        SnowlDatastore.dbConnection.commitTransaction();
      }
      catch(ex) {
        SnowlDatastore.dbConnection.rollbackTransaction();
        throw ex;
      }
    }

    this._cleanSessionHistory(messageIDs);
  },

  _cleanSessionHistory: function(aMessageIDs) {
    // Remove any deleted messages from tab's session history and set the b/f
    // index to the immediate prior message.  Due to context linking, a number of
    // pages belonging to the same message may be removed upon that message's
    // deletion.
    // XXX: clean across all tabs' history, not just current tab?
//this._log.info("_cleanSessionHistory: messageIDs - "+aMessageIDs);

    let sh = getBrowser().webNavigation.sessionHistory;
    let shEntry, uri, msgUri, msgId;
    let currIndex = sh.index, newCount = 0, restoreIndex = 0;
    let newHistory = [];

    for (i = 0; i < sh.count; i++){
      shEntry = sh.getEntryAtIndex(i, false).QueryInterface(Ci.nsISHEntry);
      uri = shEntry.URI.spec;
      msgUri = uri.split("=")[0] + "=";
      msgId = parseInt(uri.split("=")[1]);

      if (msgUri == this.MESSAGE_URI && aMessageIDs.indexOf(msgId) != -1) {
//this._log.info("_cleanSessionHistory: Delete from HISTORY - "+uri);
        if (currIndex == i)
          restoreIndex = newCount > 0 ? --newCount : newCount;
        continue;
      }

      newHistory.push(shEntry);
      newCount++;
    }

    if (newCount == 0) {
      // Only message deleted, close tab.
      getBrowser().removeTab(getBrowser().selectedTab);
      return;
    }

    sh.PurgeHistory(sh.count);
    sh.QueryInterface(Ci.nsISHistoryInternal);
    newHistory.forEach(function(shEntry) {
//SnowlMessageView._log.info("_cleanSessionHistory: Restore to HISTORY - "+uri);
      sh.addEntry(shEntry, true);
    })

    sh.QueryInterface(Ci.nsIWebNavigation).gotoIndex(restoreIndex);
  },

  onListTreeMouseDown: function(aEvent) {
//    SnowlUtils.onTreeMouseDown(aEvent, this._tree);
  },

  onTreeContextPopupHidden: function(aEvent) {
//    SnowlUtils.RestoreSelection(this._tree);
  },

};

window.addEventListener("load", function() { SnowlMessageView.init() }, false);
