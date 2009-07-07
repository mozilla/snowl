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

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/StringBundle.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/identity.js");
Cu.import("resource://snowl/modules/opml.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/source.js");

let strings = new StringBundle("chrome://snowl/locale/datastore.properties");

let gMessageViewWindow = null;
if (document.getElementById("snowlSidebar"))
  gMessageViewWindow = SnowlService.gBrowserWindow;
else if (document.getElementById("snowlRiver"))
  gMessageViewWindow = window;

let CollectionsView = {
  _log: null,

  get _tree() {
    delete this._tree;
    return this._tree = document.getElementById("sourcesView");
  },

  get _children() {
    delete this._children;
    return this._children = document.getElementById("sourcesViewTreeChildren");
  },

  get _searchFilter() {
    delete this._searchFilter;
    return this._searchFilter = document.getElementById("snowlFilter");
  },

  get _collectionsViewMenu() {
    delete this._collectionsViewMenu;
    return this._collectionsViewMenu = document.getElementById("collectionsViewMenu");
  },

  get _collectionsViewMenuPopup() {
    delete this._collectionsViewMenuPopup;
    return this._collectionsViewMenuPopup = document.getElementById("collectionsViewMenuPopup");
  },

  get _listToolbar() {
    delete this._listToolbar;
    return this._listToolbar = document.getElementById("snowlListToolbar");
  },

  get _toggleListToolbarButton() {
    delete this._toggleListToolbarButton;
    return this._toggleListToolbarButton = document.getElementById("listToolbarButton");
  },

  get itemIds() {
    let intArray = [];
    let strArray = this._tree.getAttribute("itemids").split(",");
    for each (let intg in strArray)
      intArray.push(parseInt(intg));
    delete this._itemIds;
    return this._itemIds = intArray;
  },

  set itemIds(ids) {
    this._tree.setAttribute("itemids", ids);
    delete this._itemIds;
    return this._itemIds = ids;
  },

  gListOrRiver: null,

  Filters: {
    unread: false,
    deleted: false,
    searchterms: null
  },


  //**************************************************************************//
  // Initialization & Destruction

  init: function() {
    if (document.getElementById("snowlSidebar")) {
      // Only for sidebar collections tree in list view.
      this._log = Log4Moz.repository.getLogger("Snowl.Sidebar");
      this.gListOrRiver = "list";

      if (!this._listToolbar.hasAttribute("hidden"))
        this._toggleListToolbarButton.setAttribute("checked", true);

      this.Filters["unread"] = document.getElementById("snowlUnreadButton").
                                        checked ? true : false;
      this.Filters["deleted"] = document.getElementById("snowlShowDeletedButton").
                                        checked ? true : false;
      if (this.Filters["deleted"])
        document.getElementById("snowlPurgeDeletedButton").removeAttribute("disabled");
      else
        document.getElementById("snowlPurgeDeletedButton").setAttribute("disabled", true);

      // Restore persisted view selection (need to build the menulist) or init.
      let selIndex = parseInt(this._collectionsViewMenu.getAttribute("selectedindex"));
      if (selIndex >= 0) {
        this.onPopupshowingCollectionsView();
        this._collectionsViewMenu.selectedIndex = selIndex;
      }
      else {
        this._collectionsViewMenu.setAttribute("selectedindex", 0); // "default"
        this._collectionsViewMenu.selectedIndex = 0;
      }

      // Set the view, which sets the Places query on the collections tree and
      // restores the selection.
      this.onCommandCollectionsView(this._collectionsViewMenu.value);
    }
    else if (document.getElementById("snowlRiver")) {
      // Only for collections tree in river view.
      this._log = Log4Moz.repository.getLogger("Snowl.River");
      this.gListOrRiver = "river";
      this._tree.place = SnowlPlaces.querySources;
    }

    this.loadObservers();

    // Get collections and convert to places tree - one time upgrade
    // XXX move this to datastore.js module
    if (!SnowlPlaces._placesConverted &&
        SnowlPlaces._placesInitialized &&
        SnowlPlaces._placesConverted != null) {
      // Use null as a lock in case another CollectionsView instantiated.  If
      // collections tree is unloaded before a complete conversion, a restart
      // will attempt the conversion again.
      SnowlPlaces._placesConverted = null;

      let titleMsg = strings.get("rebuildPlacesTitleMsg");
      let dialogMsg = strings.get("rebuildPlacesDialogMsg");
      SnowlService._promptSvc.alert(window, titleMsg, dialogMsg);

      this.itemIds = -1;
      if (this.gListOrRiver == "list") {
        this._collectionsViewMenu.setAttribute("selectedindex", 0); // "default"
        this._collectionsViewMenu.selectedIndex = 0;
      }
      this._getCollections();
      this._buildCollectionTree();
    }
  },

  loadObservers: function() {
    Observers.add("snowl:source:added",       this.onSourceAdded,       this);
    Observers.add("snowl:message:added",      this.onMessageAdded,      this);
    Observers.add("snowl:source:unstored",    this.onSourceRemoved,     this);
    Observers.add("snowl:messages:completed", this.onMessagesCompleted, this);
    Observers.add("itemchanged",              this.onItemChanged,       this);
    if (this.gListOrRiver == "list")
      Observers.add("snowl:author:removed", this.onSourceRemoved, this);
//this._log.info("loadObservers");
  },

  unloadObservers: function() {
    Observers.remove("snowl:source:added",       this.onSourceAdded,       this);
    Observers.remove("snowl:message:added",      this.onMessageAdded,      this);
    Observers.remove("snowl:source:unstored",    this.onSourceRemoved,     this);
    Observers.remove("snowl:messages:completed", this.onMessagesCompleted, this);
    Observers.remove("itemchanged",              this.onItemChanged,       this);
    if (this.gListOrRiver == "list")
      Observers.remove("snowl:author:removed", this.onSourceRemoved, this);
//this._log.info("unloadObservers");
  },


  //**************************************************************************//
  // Event & Notification Handlers

  onSourceAdded: function(aPlaceID) {
//this._log.info("onSourceAdded: curIndex:curSelectedIndex = "+
//  this._tree.currentIndex+" : "+this._tree.currentSelectedIndex);
    // Newly subscribed source has been added to places, select the inserted row.
    // The effect of selecting here is that onMessageAdded will trigger a view
    // refresh for each message, so messages pop into the view as added.
    this._tree.currentSelectedIndex = -1;
    setTimeout(function() {
      let viewItemIds = CollectionsView.itemIds;
      CollectionsView._tree.restoreSelection([aPlaceID]);
      if (CollectionsView._tree.view.selection.count == 0) {
        // If not in a view that shows Sources, hence nothing selected, restore
        // the view to its current state, as selectItems will clear it.
        CollectionsView._tree.restoreSelection(viewItemIds);
      }
    }, 30)
  },

  onMessageAdded: function(message) {
    // If source or author of new message is currently selected in the
    // collections list, refresh view.  This observer exists for both list and
    // river and selections may be different.
    if (this.isMessageForSelectedCollection(message)) {
      gMessageViewWindow.SnowlMessageView.onMessageAdded(message);
    }
  },

  onMessagesCompleted: function(aSourceId) {
    // Source refresh completed, reset busy property.
    if (SnowlService.sourcesByID[aSourceId])
      SnowlService.sourcesByID[aSourceId].busy = false;
      
    this._tree.treeBoxObject.invalidate();
  },

  onSourceRemoved: function() {
//this._log.info("onSourceRemoved: curIndex:gMouseEvent - "+
//  this._tree.currentIndex+" : "+SnowlUtils.gMouseEvent);
    if (!this._tree.selectedNode) {
      // Original selected row removed, reset and clear.
      this._tree.currentIndex = -1;
      this.itemIds = -1;
      gMessageViewWindow.SnowlMessageView.onCollectionsDeselect();
      }
  },

  noSelect: false,
  onSelect: function(aEvent) {
//this._log.info("onSelect start: curIndex:gMouseEvent - "+
//  this._tree.currentIndex+" : "+SnowlUtils.gMouseEvent);
    // We want to only select onClick (more precisely, mouseup) for mouse events
    // but need onSelect for key events (arrow keys).  Since onSelect events do
    // not have info on whether mouse or key, we track it ourselves.
    if (this._tree.currentIndex == -1 || SnowlUtils.gMouseEvent)
      return;

    // Don't run if suppressed.
    if (this.noSelect) {
      this.noSelect = false;
      return;
    }

    this.onClick(aEvent);
  },

  onClick: function(aEvent) {
/*
this._log.info("onClick start: curIndex:curSelectedIndex = "+
  this._tree.currentIndex+" : "+this._tree.currentSelectedIndex);
this._log.info("onClick start - gMouseEvent:gRtbutton:modKey = "+
  SnowlUtils.gMouseEvent+" : "+SnowlUtils.gRightMouseButtonDown+" : "+modKey);
this._log.info("onClick: selectionCount = "+this._tree.view.selection.count);
this._log.info("onClick: START itemIds - " +this.itemIds.toSource());
*/
    let modKey = aEvent.metaKey || aEvent.ctrlKey || aEvent.shiftKey;
    SnowlUtils.gMouseEvent = false;

    // Don't run query on twisty click.
    let row = { }, col = { }, obj = { }, rangeFirst = { }, rangeLast = { };;
    this._tree.treeBoxObject.getCellAt(aEvent.clientX, aEvent.clientY, row, col, obj);
    if (obj.value == "twisty") {
      return;
    }

    // Don't run query on right click, or already selected row (unless deselecting).
    if (SnowlUtils.gRightMouseButtonDown || this._tree.currentIndex == -1 ||
        (this._tree.view.selection.count == 1 && !modKey &&
         this._tree.currentIndex == this._tree.currentSelectedIndex))
      return;

    // Check this here post rt click.
    let isBookmark = this.isBookmark();

    // If mod key deselected, reset currentIndex and redo query.
    if (modKey && !this._tree.view.selection.isSelected(this._tree.currentIndex))
      this._tree.currentIndex = -1;

    // If multiselection, reset currentSelectedIndex so subsequent click will
    // select on any previously selected row.
    if (this._tree.view.selection.count > 1)
      this._tree.currentSelectedIndex = -1;
    else
      this._tree.currentSelectedIndex = this._tree.currentIndex;

    // Mod key click will deselect a row; for a 0 count notify view to clear.
    if (this._tree.view.selection.count == 0) {
      this._tree.currentSelectedIndex = -1;
      this.itemIds = -1;
      if (!isBookmark)
        gMessageViewWindow.SnowlMessageView.onCollectionsDeselect();
      return;
    }

    // See if it can be opened like a bookmark.
    if (isBookmark) {
      this.itemIds = -1;
      if (aEvent.keyCode == KeyEvent.DOM_VK_RETURN || aEvent.button == 0) {
        goDoCommand('placesCmd_open');
        return;
      }
    }

    if (!modKey && this.itemIds != -1)
      // Unset new status for (about to be) formerly selected collection(s).
      this.markCollectionNewState();

    // Get constraints based on selected rows
    let constraints = this.getSelectionConstraints();

    // No itemIds stored, nothing selected, so return
    if (this.itemIds == -1)
      return;

    let collection = new SnowlCollection(null,
                                         name,
                                         null, 
                                         constraints,
                                         null);
    gMessageViewWindow.SnowlMessageView.setCollection(collection, this.Filters);
  },

  onCollectionsTreeMouseDown: function(aEvent) {
    SnowlUtils.onTreeMouseDown(aEvent);
  },

  onTreeContextPopupHidden: function(aEvent) {
    SnowlUtils.RestoreSelection(aEvent, this._tree);
  },

  onSubscribe: function() {
    SnowlService.gBrowserWindow.Snowl.onSubscribe();
  },

  onRefresh: function() {
    SnowlService.refreshAllSources();
  },

  onToggleListToolbar: function(aEvent) {
    aEvent.target.checked = !aEvent.target.checked;
    if (this._listToolbar.hasAttribute("hidden"))
      this._listToolbar.removeAttribute("hidden");
    else
      this._listToolbar.setAttribute("hidden", true);
  },

  onSearch: function(aValue) {
    let searchMsgs = this._searchFilter.getAttribute("messages") == "true";
    let searchCols = this._searchFilter.getAttribute("collections") == "true";
    this.Filters["searchterms"] = aValue ? aValue : null;

    if (aValue) {
      if (searchCols)
        // Search collections.
        this.searchCollections(aValue);
      if (searchMsgs)
        // Search selected or 'All Messages' if no explicit selection.
        gMessageViewWindow.SnowlMessageView.onFilter(this.Filters);
    }
    else {
      if (searchMsgs) {
        if (this.itemIds == -1)
          // If no selection and clearing searchbox, clear list (don't select 'All').
          gMessageViewWindow.SnowlMessageView.onCollectionsDeselect();
        else
          // Re-select the selected collections.
          gMessageViewWindow.SnowlMessageView.onFilter(this.Filters);
      }
      if (searchCols){
        // Reset the collections tree.
        this._tree.place = this._tree.place;
        this.noSelect = true;
        this._tree.restoreSelection();
      }
    }
  },

  onCommandUnreadButton: function(aEvent) {
    // Unfortunately, css cannot be used to hide a treechildren row using
    // properties and pseudo element selectors.
    aEvent.target.checked = !aEvent.target.checked;
    this.Filters["unread"] = aEvent.target.checked ? true : false;

    if (this.itemIds == -1 && !this.Filters["unread"] && !this.Filters["deleted"])
      // If no selection and unchecking, clear list (don't select 'All').
      gMessageViewWindow.SnowlMessageView.onCollectionsDeselect();
    else
      gMessageViewWindow.SnowlMessageView.onFilter(this.Filters);
  },

  onCommandShowDeletedButton: function(aEvent) {
    aEvent.target.checked = !aEvent.target.checked;
    this.Filters["deleted"] = aEvent.target.checked ? true : false;

    if (this.Filters["deleted"])
      document.getElementById("snowlPurgeDeletedButton").removeAttribute("disabled");
    else
      document.getElementById("snowlPurgeDeletedButton").setAttribute("disabled", true);

    if (this.itemIds == -1 && !this.Filters["deleted"] && !this.Filters["unread"])
      // If no selection and unchecking, clear list (don't select 'All').
      gMessageViewWindow.SnowlMessageView.onCollectionsDeselect();
    else
      gMessageViewWindow.SnowlMessageView.onFilter(this.Filters);
  },

  onCommandPurgeDeletedButton: function(aEvent) {
    let deleteAllShowing = true;
    gMessageViewWindow.SnowlMessageView.onDeleteMessages(deleteAllShowing);
  },

  _resetCollectionsView: true,
  onPopupshowingCollectionsView: function(event) {
    // Build dynamic Views list.
    var list, queryVal, title, baseItemId, menuItem;

    // Rebuild first time or only if item added or removed, to maintain selection.
    if (!this._resetCollectionsView)
      return;

    while (this._collectionsViewMenuPopup.hasChildNodes() &&
        this._collectionsViewMenuPopup.lastChild.id != "collectionVewMenuSep")
      this._collectionsViewMenuPopup.removeChild(this._collectionsViewMenuPopup.lastChild);

    list = PlacesUtils.annotations
                      .getItemsWithAnnotation(SnowlPlaces.SNOWL_USER_VIEWLIST_ANNO, {});
    for (var i=0; i < list.length; i++) {
      // Parent has to be systemID otherwise get dupes if shortcut folders copied..
      if (PlacesUtils.bookmarks.
                      getFolderIdForItem(list[i]) != SnowlPlaces.collectionsSystemID)
        continue;

      queryVal = PlacesUtils.annotations.
                             getItemAnnotation(list[i],
                                               SnowlPlaces.SNOWL_USER_VIEWLIST_ANNO);

      title = PlacesUtils.bookmarks.getItemTitle(list[i]);
      baseItemId = queryVal;
      menuItem = document.createElement("menuitem");
      menuItem.setAttribute("label", title);
      menuItem.setAttribute("value", baseItemId);
      this._collectionsViewMenuPopup.appendChild(menuItem);
    }

    if (this._collectionsViewMenuPopup.lastChild.id == "collectionVewMenuSep")
      this._collectionsViewMenuPopup.lastChild.hidden = true;
    else
      document.getElementById("collectionVewMenuSep").hidden = false;

    this._resetCollectionsView = false;
  },

  onCommandCollectionsView: function(value) {
    // View is a predefined system view, or else a custom view.  The |value| is
    // the Places itemId for the view base folder (ie not the shortcut).
    this._collectionsViewMenu.setAttribute("selectedindex",
                                           this._collectionsViewMenu.selectedIndex);
    switch (value) {
      case "default":
        this._tree.place = SnowlPlaces.queryDefault;
        break;
      case "sources":
        this._tree.place = SnowlPlaces.querySources;
        break;
      case "authors":
        this._tree.place = SnowlPlaces.queryAuthors;
        break;
      default:
        // Menu must built with correct itemId values.
        this._tree.place = SnowlPlaces.queryCustom + parseInt(value);
        break;
    }
    this._tree.restoreSelection();
    this._tree.focus();
  },

  onItemChanged: function(aItemChangedObj) {
//this._log.info("onItemChanged: start itemId - "+aItemChangedObj.itemId);
      switch (aItemChangedObj.property) {
        case "title":
          // Here if notified of a title rename, either View or source/author,
          // which require special updates; others updated via places mechanisms.
//this._log.info("onItemChanged: title - "+aItemChangedObj.title);
          if (aItemChangedObj.type == "view")
            this.updateViewNames(aItemChangedObj);
          if (aItemChangedObj.type == "collection")
            this.updateCollectionNames(aItemChangedObj);
          break;
        default:
          break;
      }
  },

  refreshSource: function() {
    let selectedSources = [];

    // XXX: Multiselection?
    let selectedSource =
        this._tree.view.nodeForTreeIndex(this._tree.currentSelectedIndex);
    // Create places query object from tree item uri
    let query = new SnowlQuery(selectedSource.uri);
    if (!query.queryTypeSource)
      return;

    selectedSources.push(SnowlService.sourcesByID[query.queryID]);
    SnowlService.refreshAllSources(selectedSources);
  },

  markCollectionRead: function() {
    // Mark all selected source/author collection messages as read.  Other than
    // system collections, descendants of a folder level selection are not
    // included and must be multiselected.
    let sources = [], authors = [], query, all = false;

    let selectedNodes = this._tree.getSelectionNodes();
    for (let i=0; i < selectedNodes.length && !all; i++) {
      // Create places query object from tree item uri
      query = new SnowlQuery(selectedNodes[i].uri);
      if (query.queryFolder == SnowlPlaces.collectionsSystemID ||
          query.queryFolder == SnowlPlaces.collectionsSourcesID ||
          query.queryFolder == SnowlPlaces.collectionsAuthorsID) {
        all = true;
        break;
      }
      if (query.queryTypeSource && sources.indexOf(query.queryID, 0) < 0)
        sources.push(query.queryID);
      if (query.queryTypeAuthor && authors.indexOf(query.queryID, 0) < 0)
        authors.push(query.queryID);
    }

    query = "";
    if (!all) {
      if (sources.length > 0)
        query += "sourceID = " + sources.join(" OR sourceID = ");
      if (authors.length > 0) {
        if (sources.length > 0)
          query += " OR ";
        query += "authorID = " + authors.join(" OR authorID = ");
      }

      query = query ? "( " + query + " ) AND " : null;
    }

    if (query != null) {
      SnowlDatastore.dbConnection.executeSimpleSQL(
          "UPDATE messages SET read = " + MESSAGE_READ +
          " WHERE " + query +
          " (read = " + MESSAGE_UNREAD + " OR read = " + MESSAGE_NEW + ")");

      gMessageViewWindow.SnowlMessageView.onFilter(this.Filters);
      // Clear the collections stats cache and invalidate tree to rebuild.
      SnowlService._collectionStatsByCollectionID = null;
      this._tree.treeBoxObject.invalidate();
    }
  },

  markCollectionNewState: function() {
//this._log.info("markCollectionNewState: START ");
    // Mark all selected source/author collection messages as not new (unread)
    // upon the collection being no longer selected.  Note: shift-click on a
    // collection will leave new state when unselected.
    let itemId, uri, sources = [], authors = [], query, all = false;
    let itemIds = this.itemIds;
    let currentIndexItemId =
        this._tree.view.nodeForTreeIndex(this._tree.currentIndex).itemId

    for each (itemId in itemIds) {
      // If selecting item currently in selection, leave as new.
      if (itemId == currentIndexItemId)
        continue;

      // Create places query object from places item uri.
      try {
        uri = PlacesUtils.bookmarks.getBookmarkURI(itemId).spec;
      } catch (ex) { continue;} // Not a query item.
      query = new SnowlQuery(uri);
      if (query.queryFolder == SnowlPlaces.collectionsSystemID ||
          query.queryFolder == SnowlPlaces.collectionsSourcesID ||
          query.queryFolder == SnowlPlaces.collectionsAuthorsID) {
        all = true;
        break;
      }
      if (query.queryTypeSource && sources.indexOf(query.queryID, 0) < 0)
        sources.push(query.queryID);
      if (query.queryTypeAuthor && authors.indexOf(query.queryID, 0) < 0)
        authors.push(query.queryID);
    }

    query = "";
    if (!all) {
      if (sources.length > 0)
        query += "sourceID = " + sources.join(" OR sourceID = ");
      if (authors.length > 0) {
        if (sources.length > 0)
          query += " OR ";
        query += "authorID = " + authors.join(" OR authorID = ");
      }

      query = query ? "( " + query + " ) AND " : null;
    }

    if (query != null) {
      SnowlDatastore.dbConnection.executeSimpleSQL(
          "UPDATE messages SET read = " + MESSAGE_UNREAD +
          " WHERE " + query + "read = " + MESSAGE_NEW);

      // Clear the collections stats cache and invalidate tree to rebuild.
      SnowlService._collectionStatsByCollectionID = null;
      this._tree.treeBoxObject.invalidate();
    }
  },


  removeSource: function() {
    // Single selection removal of source for now; all messages, authors, and the
    // subscription are permanently removed.
    let source,  sourceID, selectedSourceIDs = [];
    let selectedSource = this._tree.view.nodeForTreeIndex(this._tree.currentSelectedIndex);
    let query = new SnowlQuery(selectedSource.uri);

    if (!query.queryTypeSource)
      return;

    selectedSourceIDs.push(query.queryID);

    // Delete loop here, if multiple selections..
    for (let i = 0; i < selectedSourceIDs.length; ++i) {
      sourceID = selectedSourceIDs[i];
      source = SnowlService.sourcesByID[sourceID];
this._log.info("removeSource: Removing source - " + source.id + " : " + source.name);
      source.unstore();
    }
  },

  removeAuthor: function() {
    // Removing an author permanently purges all of the author's messages (they
    // do not go into a deleted status).
//this._log.info("removeAuthor: START curIndex:curSelectedIndex = "+
//  this._tree.currentIndex+" : "+this._tree.currentSelectedIndex);
    let sourceNode, authorID;
    let selectedSourceNodeID = [];
    let selectedSourceNodesIDs = [];

    // XXX: Multiselection?

    let selectedSource =
        this._tree.view.nodeForTreeIndex(this._tree.currentSelectedIndex);
    // Create places query object from tree item uri
    let query = new SnowlQuery(selectedSource.uri);

    if (query.queryGroupIDColumn != "people.id")
      return;
this._log.info("removeAuthor: Removing author - " + selectedSource.title + " : " + selectedSource.itemId);

    selectedSourceNodeID = [selectedSource, query.queryID];
    selectedSourceNodesIDs.push(selectedSourceNodeID);

    // Delete loop here, if multiple selections..
    for (let i = 0; i < selectedSourceNodesIDs.length; ++i) {
      sourceNode = selectedSourceNodesIDs[i][0];
      authorID = selectedSourceNodesIDs[i][1];
      SnowlDatastore.dbConnection.beginTransaction();
      try {
        // Delete messages
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM partsText " +
            "WHERE docid IN " +
            "(SELECT id FROM parts WHERE messageID IN " +
            "(SELECT id FROM messages WHERE authorID = " + authorID + "))");
//this._log.info("removeAuthor: Delete messages PARTSTEXT DONE");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM parts " +
            "WHERE messageID IN " +
            "(SELECT id FROM messages WHERE authorID = " + authorID + ")");
//this._log.info("removeAuthor: Delete messages PARTS DONE");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM messages " +
            "WHERE authorID = " + authorID);
//this._log.info("removeAuthor: Delete messages DONE");
        // Delete people/identities
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM people " +
            "WHERE id IN " +
            "(SELECT personID FROM identities WHERE id = " + authorID + ")");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM identities " +
            "WHERE id = " + authorID);
//this._log.info("removeAuthor: Delete people/identities DONE");

        // Finally, clean up Places bookmark by author's place itemId.
        PlacesUtils.bookmarks.removeItem(sourceNode.itemId);
//this._log.info("removeAuthor: Delete Places DONE");

        SnowlDatastore.dbConnection.commitTransaction();
      }
      catch(ex) {
        SnowlDatastore.dbConnection.rollbackTransaction();
        throw ex;
      }
    }

    Observers.notify("snowl:author:removed");
  },

  newView: function() {
    // The ip is only in the default view, so appending the new custom view
    // shortcut at the bottom will only be visible there, although the action is
    // performed in any view.  Need to have all this to pass a 'mode'..
    let title = strings.get("newViewTitle");
    let ip = new InsertionPoint(SnowlPlaces.collectionsSystemID,
                                SnowlPlaces.DEFAULT_INDEX,
                                Ci.nsITreeView.DROP_ON);
    let info = {
      action: "add",
      type: "folder",
      hiddenRows: ["folderPicker"],
      title: title,
      defaultInsertionPoint: ip,
      mode: "view"
    };

    let dialogURL = "chrome://browser/content/places/bookmarkProperties.xul";
    let features = "centerscreen,chrome,modal,resizable=no";
    window.openDialog(dialogURL, "",  features, info);

    if ("performed" in info && info.performed) {
      // Select the new item.
//      let insertedNodeId = PlacesUtils.bookmarks
//                                      .getIdForItemAt(ip.itemId, ip.index);
//      this._tree.selectItems([insertedNodeId], false);
      this._resetCollectionsView = true;
    }
  },

  removeView: function() {
    if (this._tree.selectedNode) {
      let removeNode =
          this._tree.view.nodeForTreeIndex(this._tree.currentSelectedIndex);
      let scItem = removeNode.itemId;
      let uri = removeNode.uri;
      let query = new SnowlQuery(uri);
      let baseItem = query.queryFolder;

      if (baseItem)
        PlacesUtils.bookmarks.removeItem(baseItem);

    if (scItem) {
      // Removing a shortcut bookmark does not remove its history uri entry
      // (in moz_places), so remove it like this.  Cannot use removePage since
      // it explicitly excludes 'place:' uris.
      let PlacesDB = Cc["@mozilla.org/browser/nav-history-service;1"].
                     getService(Ci.nsPIPlacesDatabase);
      PlacesDB.DBConnection.executeSimpleSQL(
          "DELETE FROM moz_places WHERE id = " +
          "(SELECT fk FROM moz_bookmarks WHERE id = " + scItem + " )");

      PlacesUtils.bookmarks.removeItem(scItem);
    }

    this._resetCollectionsView = true;
    }
  },

  updateViewNames: function(aRenameObj) {
    // Bug 482978: need to reset tree on rename of folder shortcut, and it must
    // be in a thread or setCellText loops since the node's title is not reset.
    setTimeout(function() {
      CollectionsView._tree.place = CollectionsView._tree.place;
      CollectionsView._tree.restoreSelection();
    }, 0)

    // Reflect folder shortcut name change in the View structure.
    let newTitle = aRenameObj.title;

    // Update base folder name.
    let baseFolderId = PlacesUtils.annotations.
                                   getItemAnnotation(aRenameObj.itemId,
                                                     SnowlPlaces.SNOWL_USER_VIEWLIST_ANNO)
    var txn = PlacesUIUtils.ptm.editItemTitle(baseFolderId,
                                              "snowlUserView:" + newTitle);
    PlacesUIUtils.ptm.doTransaction(txn);

    // Force rebuild of View menulist for the new name.
    this._resetCollectionsView = true;
  },

  updateCollectionNames: function(aRenameObj) {
    // Source or Author name change.  The 'name' field is updated in the people
    // table for Authors; the externalID in identities table continues to identify
    // the unique author as sent by the source, either by name or email.
//this._log.info("updateCollectionNames: uri - "+aRenameObj.uri);
    let newTitle = aRenameObj.title;
    let uri = aRenameObj.uri;
    let query = new SnowlQuery(uri);
    let table = query.queryTypeSource ? "sources" :
                query.queryTypeAuthor ? "people" : null;

    if (table) {
      SnowlDatastore.dbConnection.executeSimpleSQL(
        "UPDATE " + table +
        " SET    name = '" + newTitle +
        "' WHERE   id = " + query.queryID);

      if (query.queryTypeSource)
        // Invalidate sources cache.
        SnowlService.onSourcesChanged();

      // Redo list so new name is reflected.
      gMessageViewWindow.SnowlMessageView.onFilter(this.Filters);
//this._log.info("updateCollectionNames: newUri - "+newUri);
    }
  },

  searchCollections: function(aSearchString) {
    // XXX: Bug 479903, place queries have no way of excluding search in uri,
    // which may not be meaningful for our usage.
    let searchFolders = [];
    let view = this._collectionsViewMenu.value;
    if (view && view != "default")
      // Limit search to authors/sources/custom if that view selected, else all
      searchFolders = view == "sources" ? [SnowlPlaces.collectionsSourcesID] :
                      view == "authors" ? [SnowlPlaces.collectionsAuthorsID] :
                                          [parseInt(view)];
    else {
      // XXX Get selected items and search only those
      searchFolders = [SnowlPlaces.collectionsSystemID];
    }

    if (!aSearchString)
      this._tree.place = this._tree.place;
    else {
      this._tree.applyFilter(aSearchString, searchFolders);
      
    }
  },

  isMessageForSelectedCollection: function(aMessage) {
    // Determine if source or author of new message is currently selected in the
    // collections list.
    // XXX: see if there is a Places event/mechanism we can use instead?
    let query, uri, rangeFirst = { }, rangeLast = { }, refreshFlag = false;
    let numRanges = this._tree.view.selection.getRangeCount();

    if (this.Filters["deleted"])
      // Don't refresh if showing deleted for selected collection.
      return refreshFlag;

    for (let i = 0; i < numRanges && !refreshFlag; i++) {
      this._tree.view.selection.getRangeAt(i, rangeFirst, rangeLast);
      for (let index = rangeFirst.value; index <= rangeLast.value; index++) {
        uri = this._tree.view.nodeForTreeIndex(index).uri;
        query = new SnowlQuery(uri);
        if ((query.queryGroupIDColumn == "sources.id" &&
             query.queryID == aMessage.source.id) ||
            (query.queryGroupIDColumn == "people.id" &&
             query.queryID == aMessage.author.id) ||
            // Collection folders that return all records
            query.queryFolder == SnowlPlaces.collectionsSystemID)
          refreshFlag = true;
      }
    }

    return refreshFlag;
  },

  isBookmark: function() {
    // Determine if a uri that can be passed to url opener, ie a bookmark.
    let query, uri;
    let index = this._tree.currentIndex;
    uri = this._tree.view.nodeForTreeIndex(index).uri;
    query = new SnowlQuery(uri);
    if (query.queryProtocol == "snowl:" || query.queryProtocol == "place:")
      return false;
    else
      return true;
  },

  getSelectionConstraints: function() {
    // Return contraints object based on selected itemIds in the collections
    // tree and persist the list
    let constraints = [], selectedItemIds = [];
    let itemId, uri, rangeFirst = { }, rangeLast = { }, stop = false;
    let numRanges = this._tree.view.selection.getRangeCount();

    for (let i = 0; i < numRanges && !stop; i++) {
      this._tree.view.selection.getRangeAt(i, rangeFirst, rangeLast);
      for (let index = rangeFirst.value; index <= rangeLast.value; index++) {
        itemId = this._tree.view.nodeForTreeIndex(index).itemId;
        selectedItemIds.push(itemId);
        uri = this._tree.view.nodeForTreeIndex(index).uri;
        let query = new SnowlQuery(uri);
        if (query.queryFolder == SnowlPlaces.collectionsSystemID) {
          // Collection folder that returns all records, break with no constraints.
          // There may be other such 'system' collections but more likely collections
          // will be rows which are user defined snowl: queries.  Selection of a
          // user created Places 'folder', ie non tag or saved search will clear
          // the messages view (null constraint will be added below).
          constraints = [];
          stop = true;
          break;
        }
        else {
          // Construct the contraint to be passed to the collection object for
          // the db query.
          let constraint = { };
          constraint.expression = query.queryGroupIDColumn +
                                  " = :groupValue" + index;
          constraint.parameters = { };
          constraint.parameters["groupValue" + index] = query.queryID;
          constraint.operator = "OR";
          constraints.push(constraint);
        }
      }
    }

    this.itemIds = selectedItemIds.length ? selectedItemIds : -1;
//this._log.info("getSelectionConstraints: constraints = " + constraints.toSource());
//this._log.info("getSelectionConstraints: itemIds = " + this.itemIds);
    return constraints;
  },

  buildContextMenu: function(aPopup) {
    // extra contextmenu customization here
  },


  //**************************************************************************//
  // Places conversion

  // Create the source/authors collection from the db to convert to places.
  _collections: null,
  _getCollections: function() {
    this._collections = [];
this._log.info("_getCollections: Convert to Places: START");

    let statement = SnowlDatastore.createStatement(
      "SELECT id, name, iconURL, grouped, groupIDColumn, groupNameColumn, " +
        "groupHomeURLColumn, groupIconURLColumn " +
      "FROM collections ORDER BY orderKey"
    );

    statement.QueryInterface(Ci.mozIStorageStatementWrapper);

    try {
      while (statement.step()) {
        this._collections.push(new SnowlCollection(statement.row.id,
                                                   statement.row.name,
                                                   URI.get(statement.row.iconURL),
                                                   null,
                                                   null,
                                                   statement.row.grouped ? true : false,
                                                   statement.row.groupIDColumn,
                                                   statement.row.groupNameColumn,
                                                   statement.row.groupHomeURLColumn,
                                                   statement.row.groupIconURLColumn));
      }
    }
    finally {
      statement.reset();
    }
  },

  // Convert the list of rows in the tree to places.
  _buildCollectionTree: strand(function() {
    gMessageViewWindow.XULBrowserWindow.
                       setOverLink("Conversion to Places started");
this._log.info("_buildCollectionTree: Convert to Places: START");
    for each (let collection in this._collections) {
      if (collection.grouped) {
        let table, value, sourceID, personID, externalID, machineURI, placeID;
        switch (collection.groupIDColumn) {
          case "sources.id":
            table = "sources";
            break;
          case "authors.id":
            table = "people";
            break;
          default:
            table = null;
            break;
        }
        for each (let group in collection.groups) {
//this._log.info(table+" group.name:group.groupID - " + 
//  group.name + " : " + group.groupID);
          if (table == "sources") {
            value = group.groupID;
            machineURI = SnowlService.sourcesByID[group.groupID].machineURI;
          }
          else if (table == "people") {
            if (!group.groupID)
              // Skip null authors
              continue;
            // Get the sourceID that the author belongs to
            [value, externalID] = SnowlDatastore.selectIdentitiesSourceID(group.groupID);
          }
          placeID = SnowlPlaces.persistPlace(table,
                                             group.groupID,
                                             group.name,
                                             machineURI,
                                             externalID,
                                             group.iconURL,
                                             value); // aSourceID
          // Store placeID back into messages for db integrity
          SnowlDatastore.dbConnection.executeSimpleSQL(
            "UPDATE " + table +
            " SET    placeID = " + placeID +
            " WHERE       id = " + group.groupID);

          gMessageViewWindow.XULBrowserWindow.
                             setOverLink("Converted to Places: " +
                                         table + " - " + group.name);
//this._log.info("Converted to places - " +
//  group.name + " : " + group.groupID + " : " + placeID);

          yield sleep(10);
        }
      }
    }
    gMessageViewWindow.XULBrowserWindow.
                       setOverLink("Conversion to Places completed");
this._log.info("_buildCollectionTree: Convert to Places: END");
    SnowlPlaces._placesConverted = true;
    SnowlPlaces.setPlacesVersion(SnowlPlaces.snowlPlacesFolderId);
  })

};

/**
 * PlacesTreeView overrides here.
 */

/**
 * Override canDrop, do not drop a View shortcut into another View; it doesn't
 * make sense and very bad things happen to the tree.
 */
//PlacesTreeView.prototype._canDrop = PlacesTreeView.prototype.canDrop;
PlacesTreeView.prototype.canDrop = SnowlTreeViewCanDrop;
function SnowlTreeViewCanDrop(aRow, aOrientation) {
  if (!this._result)
    throw Cr.NS_ERROR_UNEXPECTED;

  // drop position into a sorted treeview would be wrong
  if (this.isSorted())
    return false;

  var ip = this._getInsertionPoint(aRow, aOrientation);

  // Custom handling for Sys collections and View shortcut.  Disallow Sys folder
  // dnd copy.  Allow move/drop of View only onto its parent (reorder);
  // disallow any multiselection dnd if it contains a Sys or View node.
  let isSys = false, isView = false;
  let dropNodes = CollectionsView._tree.getSelectionNodes();
  for (let i=0; i < dropNodes.length && (!isSys || !isView); i++) {
    isSys = PlacesUtils.annotations.
                        itemHasAnnotation(dropNodes[i].itemId,
                                          SnowlPlaces.SNOWL_COLLECTIONS_ANNO);
    isView = PlacesUtils.annotations.
                         itemHasAnnotation(dropNodes[i].itemId,
                                           SnowlPlaces.SNOWL_USER_VIEWLIST_ANNO);
  }
  if ((isSys || isView) &&
      (dropNodes.length > 1 || (ip && ip.itemId != SnowlPlaces.collectionsSystemID)))
    return false;

  return ip && PlacesControllerDragHelper.canDrop(ip);
};

/**
 * Overload getCellProperties, set custom properties.
 */
PlacesTreeView.prototype._getCellProperties = PlacesTreeView.prototype.getCellProperties;
PlacesTreeView.prototype.getCellProperties = SnowlTreeViewGetCellProperties;
function SnowlTreeViewGetCellProperties(aRow, aColumn, aProperties) {
  this._getCellProperties(aRow, aColumn, aProperties);

  let query, anno, propStr, propArr, prop, collID, source;
  let node = this._visibleElements[aRow].node;
  query = new SnowlQuery(node.uri);

  // Set title property.
  aProperties.AppendElement(this._getAtomFor("title-" + node.title));

  // Set new and unread propeties.
  collID = query.queryTypeSource ? "s" + query.queryID :
           query.queryTypeAuthor ? "a" + query.queryID :
          (query.queryFolder == SnowlPlaces.collectionsSystemID ||
           query.queryFolder == SnowlPlaces.collectionsSourcesID ||
           query.queryFolder == SnowlPlaces.collectionsAuthorsID) ? "all" : null;
  source = SnowlService.sourcesByID[query.queryID];

  var nodeStats = SnowlService.getCollectionStatsByCollectionID()[collID];
  if (nodeStats && nodeStats.u && !node.containerOpen)
    aProperties.AppendElement(this._getAtomFor("hasUnread"));
  if (nodeStats && nodeStats.n && !node.containerOpen)
    aProperties.AppendElement(this._getAtomFor("hasNew"));
  if (((source && source.busy) || (nodeStats && nodeStats.busy)) && !node.containerOpen)
    aProperties.AppendElement(this._getAtomFor("isBusy"));
  if (source && source.error && !node.containerOpen)
    aProperties.AppendElement(this._getAtomFor("hasError"));

//if (nodeStats)
//SnowlPlaces._log.info("getCellProperties: itemId:title:stats - "+
//  query.queryID+" : "+node.title+" : "+nodeStats.toSource());

  // Determine if anno where we get the properties string is properties anno
  // (for sys collections and views) or source/author anno.
  anno = query.queryTypeSource ? SnowlPlaces.SNOWL_COLLECTIONS_SOURCE_ANNO :
          query.queryTypeAuthor ? SnowlPlaces.SNOWL_COLLECTIONS_AUTHOR_ANNO :
          query.queryProtocol == "place:" ? SnowlPlaces.SNOWL_PROPERTIES_ANNO :
          null;
//SnowlPlaces._log.info("getCellProperties: itemId:anno - "+node.itemId+" : "+anno+" : "+node.title);

  if (!anno)
    return;

  // Get the right anno.
  // XXX: use the node's propertyBag as cache here?
  try {
    if (anno == SnowlPlaces.SNOWL_PROPERTIES_ANNO)
      propStr = PlacesUtils.annotations.getItemAnnotation(node.itemId, anno);
    else
      propStr = PlacesUtils.annotations.getPageAnnotation(URI(node.uri), anno);
  }
  catch(ex) {
    // No properties anno for this node's itemId/uri.
  };

  if (!propStr)
    return;

//SnowlPlaces._log.info("getCellProperties: propStr - "+propStr);
  // Set the properties atoms.
  propArr = propStr.split(",");
  if (propArr.length > 0)
    for each (prop in propArr)
      aProperties.AppendElement(this._getAtomFor(prop));
};

/**
 * Override getImageSrc for 'new' icon on collections, bookmarks with icons do
 * not seem to respect css overrides.
 */
//PlacesTreeView.prototype._getImageSrc = PlacesTreeView.prototype.getImageSrc;
PlacesTreeView.prototype.getImageSrc = SnowlTreeViewGetImageSrc;
function SnowlTreeViewGetImageSrc(aRow, aColumn) {
  this._ensureValidRow(aRow);

  // only the title column has an image
  if (this._getColumnType(aColumn) != this.COLUMN_TYPE_TITLE)
    return "";

  var node = this._visibleElements[aRow].node;

  // Custom handling for 'new' in collections.
  let query = new SnowlQuery(node.uri);
  let collID = query.queryTypeSource ? "s" + query.queryID :
               query.queryTypeAuthor ? "a" + query.queryID :
              (query.queryFolder == SnowlPlaces.collectionsSystemID ||
               query.queryFolder == SnowlPlaces.collectionsSourcesID ||
               query.queryFolder == SnowlPlaces.collectionsAuthorsID) ? "all" : null;
  let nodeStats = SnowlService.getCollectionStatsByCollectionID()[collID];
  let source = SnowlService.sourcesByID[query.queryID];

  if ((nodeStats && (nodeStats.n || nodeStats.busy)) ||
      (source && (source.busy || source.error)))
    // Don't set icon, let css handle it for 'new' or 'busy' or 'error'.
    // "all" collection (only) has a busy property so we can set an indicator on
    // a closed container.
    return "";

  var icon = node.icon;
  if (icon)
    return icon.spec;
  return "";
};

/**
 * Overload setCellText, allow inline renaming and handle folder shortcut items.
 */
PlacesTreeView.prototype._setCellText = PlacesTreeView.prototype.setCellText;
PlacesTreeView.prototype.setCellText = SnowlTreeViewSetCellText;
function SnowlTreeViewSetCellText(aRow, aColumn, aText) {
  this._setCellText(aRow, aColumn, aText);

  // Custom handling for Views or Source/Author name changes.
  let node = this.nodeForTreeIndex(aRow);
  SnowlPlaces.renamePlace(node.itemId, node.uri, aText);
};

/**
 * Overload itemRemoved, restore selection when any row is removed
 */
PlacesTreeView.prototype._itemRemoved = PlacesTreeView.prototype.itemRemoved;
PlacesTreeView.prototype.itemRemoved = SnowlTreeViewItemRemoved;
function SnowlTreeViewItemRemoved(aParent, aItem, aOldIndex) {
  this._itemRemoved(aParent, aItem, aOldIndex);

  // Restore; note that itemRemoved is called on each item manipulated in a sort.
  CollectionsView._tree.restoreSelection();
};

/**
 * Overload toggleOpenState to address Bug 477806: closing container with
 * selected child selects the container, does not remember selected child on open.
 */
PlacesTreeView.prototype._toggleOpenState = PlacesTreeView.prototype.toggleOpenState;
PlacesTreeView.prototype.toggleOpenState = SnowlTreeViewToggleOpenState;
function SnowlTreeViewToggleOpenState(aRow) {
  let firstvisrow = CollectionsView._tree.treeBoxObject.getFirstVisibleRow();

  this._toggleOpenState(aRow);

  // Restore itemdIds, if there are any selected in a closed container, on open.
  let container = this._visibleElements[aRow].node;
  let selItemIds = CollectionsView.itemIds;
  if (container.containerOpen && container.hasChildren) {
    for (let i=0; i < container.childCount; i++) {
      let child = container.getChild(i);
      if (selItemIds.indexOf(child.itemId) != -1)
        CollectionsView._tree.view.selection.toggleSelect(child.viewIndex);
    }
  }

  // Don't autoselect folder on close.
  if (selItemIds.indexOf(container.itemId) == -1 &&
      CollectionsView._tree.view.selection.isSelected(container.viewIndex))
    CollectionsView._tree.view.selection.toggleSelect(container.viewIndex);

  // Ensure twisty row doesn't move in the view, otherwise getCellAt is no
  // longer valid in onClick, plus it's annoying.  Usually restoreSelection()
  // needs to make a selected row visible..
  CollectionsView._tree.treeBoxObject.scrollToRow(firstvisrow);
};

/**
 * Override getBestTitle and add collection stats info.
 */
PlacesUIUtils.getBestTitle =
  function (aNode) {
//SnowlPlaces._log.info("getBestTitle: title - "+aNode.title);
    var title;
    if (!aNode.title && PlacesUtils.uriTypes.indexOf(aNode.type) != -1) {
      // if node title is empty, try to set the label using host and filename
      // PlacesUtils._uri() will throw if aNode.uri is not a valid URI
      try {
        var uri = PlacesUtils._uri(aNode.uri);
        var host = uri.host;
        var fileName = uri.QueryInterface(Ci.nsIURL).fileName;
        // if fileName is empty, use path to distinguish labels
        title = host + (fileName ?
                        (host ? "/" + this.ellipsis + "/" : "") + fileName :
                        uri.path);
      }
      catch (e) {
       // Use (no title) for non-standard URIs (data:, javascript:, ...)
       title = "";
      }
    }
    else {
      title = aNode.title;

      // Custom title with stats.
      let query, collID, nodeStats, titleStats = "";
      query = new SnowlQuery(aNode.uri);
      collID = query.queryTypeSource ? "s" + query.queryID :
               query.queryTypeAuthor ? "a" + query.queryID :
               query.queryFolder == SnowlPlaces.collectionsSystemID ? "all" : null;
    
      nodeStats = SnowlService.getCollectionStatsByCollectionID()[collID];
      if (nodeStats && collID == "all")
        titleStats = " (New:" + nodeStats.n + " Unread:" + nodeStats.u + " Total:" + nodeStats.t + ")";
      else if (nodeStats)
        titleStats = " (" + nodeStats.n + " " + nodeStats.u + " " + nodeStats.t + ")";

      title = title + titleStats;
     }

     return title || this.getString("noTitle");
};

/**
 * XULBrowserWindow overrides here, from browser.js for collections tree.
 */
gMessageViewWindow.XULBrowserWindow.setOverLink =
  function (link, b) {
    let statusbartext;
    // Encode bidirectional formatting characters.
    // (RFC 3987 sections 3.2 and 4.1 paragraph 6)
    statusbartext = link.replace(/[\u200e\u200f\u202a\u202b\u202c\u202d\u202e]/g,
                                 encodeURIComponent);

    // Snowl
    if (statusbartext.indexOf("snowl:") == 0) {
      // Source
      if (statusbartext.indexOf("&u=") != -1) {
        statusbartext = decodeURI(statusbartext);
        statusbartext = statusbartext.split("&u=")[1].split("&")[0];
      }
      // Author
      else if (statusbartext.indexOf("&e=") != -1) {
          statusbartext = decodeURI(statusbartext);
          statusbartext = statusbartext.split("&e=")[1].split("&")[0];
          statusbartext = statusbartext == "" ? " " : statusbartext;
      }
    }

    this.overLink = statusbartext;
    this.updateStatusField();
};

window.addEventListener("load", function() { CollectionsView.init() }, true);
