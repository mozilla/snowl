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
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/identity.js");
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/opml.js");
//Cu.import("resource://snowl/components/components.js");

let gBrowserWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIWebNavigation).
                     QueryInterface(Ci.nsIDocShellTreeItem).
                     rootTreeItem.
                     QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIDOMWindow);

let gMessageViewWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                         getInterface(Ci.nsIWebNavigation).
                         QueryInterface(Ci.nsIDocShellTreeItem).
                         rootTreeItem.
                         QueryInterface(Ci.nsIInterfaceRequestor).
                         getInterface(Ci.nsIDOMWindow);

let CollectionsView = {
  _log: null,

  get _tree() {
    delete this._tree;
    return this._tree = document.getElementById("sourcesView");
  },

  get _children() {
    delete this._children;
    return this._children = document.getElementById("sourcesViewChildren");
  },


  //**************************************************************************//
  // Initialization & Destruction

  init: function() {
    this._log = Log4Moz.repository.getLogger("Snowl.Sidebar");
    Observers.add("snowl:sources:changed", this.onSourcesChanged, this);
    Observers.add("snowl:messages:changed", this.onMessagesChanged, this);

    // Intialize places 
    SnowlDatastorePlaces.init();
    if (!this._tree.hasAttribute("flat"))
      this._tree.setAttribute("flat", true);
    let query = this._tree.getAttribute("flat") == "true" ?
        SnowlDatastorePlaces.queryFlat : SnowlDatastorePlaces.queryGrouped;

    if (!SnowlDatastorePlaces.convertedToPlaces) {
      this._getCollections();
      this._buildCollectionTree();
    }
    this._tree.place = query;

    // Ensure collection selection maintained, if in List sidebar
    if (document.getElementById("snowlSidebar"))
      this._tree.view.selection.select(SnowlUtils.gListViewCollectionIndex);
  },


  //**************************************************************************//
  // nsITreeView
/*
  getImageSrc: function(row, column) {
    if (column.id == "nameCol") {
      let iconURL = this._rows[row].iconURL;
      if (iconURL)
        return iconURL.spec;
    }

    return null;
  },
*/


  //**************************************************************************//
  // Event & Notification Handlers

  onSourcesChanged: function() {
//    this._getCollections();
    // Rebuild the view to reflect the new collection of messages.
    // Since the number of rows might have changed, we do this by reinitializing
    // the view instead of merely invalidating the box object (which doesn't
    // expect changes to the number of rows).
//    this._buildCollectionTree();

    // Refresh places tree, necessary in grouped mode (but not flat); maintain
    // selection always
    this._tree.place = this._tree.place;
//    this._tree.view.selection.select(SnowlUtils.gListViewCollectionIndex);
  },

  onMessagesChanged: function() {
    // When messages change, the list of users we display might also change,
    // so we rebuild the view from scratch.
//    this._getCollections();
//    this._buildCollectionTree();

    // Refresh places tree, necessary in grouped mode (but not flat); maintain
    // selection always
    this._tree.place = this._tree.place;
//    this._tree.view.selection.select(SnowlUtils.gListViewCollectionIndex);
  },

  _collections: null,
  _getCollections: function() {
    this._collections = [];

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

  // Build the list of rows in the tree.  By default, all containers
  // are closed, so this is the same as the list of collections, although
  // in the future we might persist and restore the open state.
  _buildCollectionTree: function() {
    // XXX: add in proper scrollling/row selection code
//    this._tree.view.selection.select(-1);
////    let index, uri, title, anno;
//    if (!this.flatList) {
//      this._rows_Hierarchical = [collection for each (collection in this._collections)];
//    }
//    else {
////      this._rows_Flat = [];
      for each (let collection in this._collections) {
        if (collection.grouped) {
          // Create group folder
          let type, uri, value;
          switch (collection.groupIDColumn) {
            case "sources.id":
              type = "Sources";
              break;
            case "authors.id":
              type = "Authors";
              break;
            default:
              type = null;
              break;
          }
          let anno = SnowlDatastorePlaces.SNOWL_COLLECTIONS_GROUPEDFOLDER_ANNO + type;
          for each (let group in collection.groups) {
            if (type == "Sources") {
              uri = URI("snowl:sources.id=" + group.groupID +
                        "&name=" + group.name +
                        "&groupIDColumn=" + collection.groupIDColumn +
                        "&");
              value = "snowl:sourceID=" + group.groupID;
            }
            else if (type == "Authors") {
              uri = URI("snowl:authors.id=" + group.groupID +
                        "&name=" + group.name +
                        "&groupIDColumn=" + collection.groupIDColumn +
                        "&");
              value = "snowl:sourceID=" + group.groupID;
//              PlacesUtils.tagging.tagURI(uri, ["snowl:sourceID=" + type], 1);
            }
this._log.info("GROUPED:name:uri - " + group.name + " : " + uri.spec);
            let id = PlacesUtils.bookmarks.
                                 insertBookmark(SnowlDatastorePlaces.collectionsFlatID,
                                                uri,
                                                PlacesUtils.bookmarks.DEFAULT_INDEX,
                                                group.name);
            PlacesUtils.annotations.
                        setPageAnnotation(uri,
//                        setItemAnnotation(id,
                                          anno,
                                          value,
                                          0,
                                          PlacesUtils.annotations.EXPIRE_NEVER);
          }
        }
    }
  },

  queryID: null,
  queryName: null,
  queryGroupIDColumn: null,
  queryObject: function(aNode) {
    let selectedURI = decodeURI(aNode.uri);
//this._log.info("onSELECT:selURI - " + selectedURI);
    this.queryID = selectedURI.split(".id=")[1].split("&")[0];
    this.queryName = selectedURI.split("name=")[1].split("&")[0];
    this.queryGroupIDColumn = selectedURI.split("groupIDColumn=")[1].split("&")[0];
//this._log.info("onSELECT:id:name:groupName - " +
//  this.queryID + " : " + this.queryName + " : " + this.queryGroupIDColumn);
  },
  
  onSelect: function(aEvent) {
    if (this._tree.currentIndex == -1 || SnowlUtils.gRightMouseButtonDown)
      return;

    let constraints = [];

    if (PlacesUtils.nodeIsQuery(this._tree.selectedNode) ||
        this._tree.selectedNode.itemId == SnowlDatastorePlaces.collectionsGroupedFolderID) {
      // Node is grouped All Messages/Sources/Authors or flat All Messages
      // XXX this needs to be less 'hardcoded'
      constraints = null;
    }
    else {
      // Node is leaf - source or author
      this.queryObject(this._tree.selectedNode);
      constraints.push({ expression: this.queryGroupIDColumn + " = :groupValue",
                         parameters: { groupValue: this.queryID } });
    }

    let collection = new SnowlCollection(null, name, null, constraints, null);

    SnowlUtils.gListViewCollectionIndex = this._tree.currentIndex;
    SnowlUtils.gListViewCurrentNode = this._tree.selectedNode;
//this._log.info("onSelect curNode index: " + SnowlUtils.gListViewCurrentNode.viewIndex);
    gMessageViewWindow.SnowlMessageView.setCollection(collection);
  },

  onCollectionsTreeMouseDown: function(aEvent) {
    SnowlUtils.onTreeMouseDown(aEvent, this._tree);
  },

  onTreeContextPopupHidden: function() {
    if (!SnowlUtils.gSelectOnRtClick)
      SnowlUtils.RestoreSelectionWithoutContentLoad(this._tree);
  },

  onSubscribe: function() {
    gBrowserWindow.Snowl.onSubscribe();
  },

  onUnsubscribe: function() {
    this.unsubscribe();
  },

  onRefresh: function() {
    SnowlService.refreshAllSources();
  },

  refreshSource: function() {
    let selectedSourceIDs = [];

    // XXX: put in a loop for multiselected collections?
    let selectedSource = this._rows[SnowlUtils.gListViewCollectionIndex];

    if (!selectedSource.parent || selectedSource.parent.groupIDColumn != "sources.id")
      return;
//this._log.info("refreshing selected source ID: "+selectedSource.groupID);

    selectedSourceIDs.push(selectedSource.groupID);

    let selectedSources = SnowlService.sources.
      filter(function(source) selectedSourceIDs.indexOf(source.id) != -1);
    SnowlService.refreshAllSources(selectedSources);
  },

  unsubscribe: function() {
    let selectedSourceNodeID = [];
    let selectedSourceNodesIDs = [];
    this.queryObject(this._tree.selectedNode);
    let currentSourceID = this.queryID;
    let notifyID = null;
    let unsubCurSel = false;

    // XXX: Mutliselection: since only a source type may be unsubscribed and
    // the tree contains mixed types of items, this needs some thought. Single
    // selection only for now.
    // XXX: fix contextmenu

    let selectedSource =
        this._tree.view.nodeForTreeIndex(SnowlUtils.gListViewCollectionIndex);
    // No selection or unsubscribing current selection?
    if (!SnowlUtils.gListViewCurrentNode ||
        selectedSource.viewIndex == SnowlUtils.gListViewCurrentNode.viewIndex)
      unsubCurSel = true;
    // Create places query object from tree item uri
    this.queryObject(selectedSource);

    if (this.queryGroupIDColumn != "sources.id")
      return;
this._log.info("unsubscribing source - " + this.queryName + " : " + selectedSource.itemId);

    selectedSourceNodeID = [selectedSource, this.queryID];
    selectedSourceNodesIDs.push(selectedSourceNodeID);

    // Delete loop here, if multiple selections..
    for (let i = 0; i < selectedSourceNodesIDs.length; ++i) {
      sourceNode = selectedSourceNodesIDs[i][0];
      sourceID = selectedSourceNodesIDs[i][1];
      SnowlDatastore.dbConnection.beginTransaction();
      try {
        // Delete messages
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM metadata " +
            "WHERE messageID IN " +
            "(SELECT id FROM messages WHERE sourceID = " + sourceID + ")");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM partsText " +
            "WHERE docid IN " +
            "(SELECT id FROM parts WHERE messageID IN " +
            "(SELECT id FROM messages WHERE sourceID = " + sourceID + "))");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM parts " +
            "WHERE messageID IN " +
            "(SELECT id FROM messages WHERE sourceID = " + sourceID + ")");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM messages " +
            "WHERE sourceID = " + sourceID);
        // Delete people/identities
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM people " +
            "WHERE id IN " +
            "(SELECT personId FROM identities WHERE sourceID = " + sourceID + ")");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM identities " +
            "WHERE sourceID = " + sourceID);
        // Delete the source
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM sources " +
            "WHERE id = " + sourceID);
        // Finally, clean up the places tree
        // Authors
        let anno = SnowlDatastorePlaces.SNOWL_COLLECTIONS_GROUPEDFOLDER_ANNO + "Authors";
        let pages = PlacesUtils.annotations.getPagesWithAnnotation(anno, { });
        for (let i = 0; i < pages.length; ++i) {
          let annoVal = PlacesUtils.annotations.getPageAnnotation(pages[i], anno);
          if (annoVal == "snowl:sourceID=" + sourceID) {
            let bookmarkIds = PlacesUtils.bookmarks.getBookmarkIdsForURI(pages[i], {});
            for (let j=0; j < bookmarkIds.length; j++) {
              PlacesUtils.bookmarks.removeItem(bookmarkIds[j]);
            }
          }
        }
        // Source
        PlacesUtils.bookmarks.removeItem(sourceNode.itemId);

        SnowlDatastore.dbConnection.commitTransaction();
      }
      catch(ex) {
        SnowlDatastore.dbConnection.rollbackTransaction();
        throw ex;
      }
      if (sourceID == currentSourceID)
        notifyID = sourceID;
    }

    // Set selection to original or -1 if removing current selection,
    // necessary to do this explicitly in grouped collections.
    this._tree.view.itemRemoved(selectedSource.parent, selectedSource, null);
    SnowlUtils.gListViewCollectionIndex = unsubCurSel ? -1 :
        this._tree.view.treeIndexForNode(SnowlUtils.gListViewCurrentNode);
    SnowlUtils.gListViewDeleteOrMove = true;

    Observers.notify("snowl:sources:changed");
    // If the current selection is unsubscribed, pass its id on to list view
    Observers.notify("snowl:messages:changed", notifyID);
    Observers.notify("snowl:source:removed");
  }

};

window.addEventListener("load", function() { CollectionsView.init() }, true);
