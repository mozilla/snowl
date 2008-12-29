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

let gBrowserWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
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
    return this._children = this._tree.getElementsByTagName("treechildren")[0];
  },

  isHierarchical: gBrowserWindow.Snowl._prefs.get("collection.hierarchicalView"),

  //**************************************************************************//
  // Initialization & Destruction

  init: function() {
    this._log = Log4Moz.repository.getLogger("Snowl.Sidebar");
    Observers.add("snowl:sources:changed", this.onSourcesChanged, this);
    this._getCollections();
    this._buildCollectionTree();

    // Ensure collection selection maintained, if in List sidebar
    if (document.getElementById("snowlSidebar"))
      this._tree.view.selection.select(SnowlUtils.gListViewCollectionIndex);
  },


  //**************************************************************************//
  // nsITreeView

  selection: null,

  get rowCount() {
    return this._rows.length;
  },

  // FIXME: consolidate these two references.
  _treebox: null,
  setTree: function(treeBox) {
    this._treeBox = treeBox;
  },

  getCellText : function(row, column) {
    return this._rows[row].name;
  },

  isContainer: function(row) {
    //this._log.info("isContainer: " + (this._rows[row].groups ? true : false));
    return (this._rows[row].groups ? true : false);
  },
  isContainerOpen: function(row) {
    //this._log.info("isContainerOpen: " + this._rows[row].isOpen);
    return this._rows[row].isOpen;
  },
  isContainerEmpty: function(row) {
    //this._log.info("isContainerEmpty: " + row + " " + this._rows[row].groups.length + " " + (this._rows[row].groups.length == 0));
    return (this._rows[row].groups.length == 0);
  },

  isSeparator: function(row)         { return false },
  isSorted: function()               { return false },

  // FIXME: make this return true for collection names that are editable,
  // and then implement name editing on the new architecture.
  isEditable: function(row, column)  { return false },

  getParentIndex: function(row) {
    //this._log.info("getParentIndex: " + row);

    let thisLevel = this.getLevel(row);

    if (thisLevel == 0)
      return -1;
    for (let t = row - 1; t >= 0; t--)
      if (this.getLevel(t) < thisLevel)
        return t;

    throw "getParentIndex: couldn't figure out parent index for row " + row;
  },

  getLevel: function(row) {
    //this._log.info("getLevel: " + row);

    if (!this.isHierarchical)
      return 0;

    return this._rows[row].level;
  },

  hasNextSibling: function(idx, after) {
    //this._log.info("hasNextSibling: " + idx + " " + after);

    let thisLevel = this.getLevel(idx);
    for (let t = idx + 1; t < this._rows.length; t++) {
      let nextLevel = this.getLevel(t);
      if (nextLevel == thisLevel)
        return true;
      if (nextLevel < thisLevel)
        return false;
    }

    return false;
  },

  getImageSrc: function(row, column) {
    if (column.id == "nameCol") {
      let iconURL = this._rows[row].iconURL;
      if (iconURL)
        return iconURL.spec;
    }

    return null;
  },

  toggleOpenState: function(idx) {
    //this._log.info("toggleOpenState: " + idx);

    let item = this._rows[idx];
    if (!item.groups)
      return;

    if (item.isOpen) {
      item.isOpen = false;

      let thisLevel = this.getLevel(idx);
      let numToDelete = 0;
      for (let t = idx + 1; t < this._rows.length; t++) {
        if (this.getLevel(t) > thisLevel)
          numToDelete++;
        else
          break;
      }
      if (numToDelete) {
        this._rows.splice(idx + 1, numToDelete);
        this._treeBox.rowCountChanged(idx + 1, -numToDelete);
      }
    }
    else {
      item.isOpen = true;

      let groups = this._rows[idx].groups;
      for (let i = 0; i < groups.length; i++)
        this._rows.splice(idx + 1 + i, 0, groups[i]);
      this._treeBox.rowCountChanged(idx + 1, groups.length);
    }
  },

  getRowProperties: function (row, properties) {},
  getCellProperties: function (row, column, properties) {},
  getColumnProperties: function(columnID, column, properties) {},

  setCellText: function(aRow, aCol, aValue) {
    let statement = SnowlDatastore.createStatement(
      "UPDATE sources SET name = :name WHERE id = :id");
    statement.params.name = this._rows[aRow].name = aValue;
    statement.params.id = this._rows[aRow].id;

    try {
      statement.execute();
    }
    finally {
      statement.reset();
    }
  },


  //**************************************************************************//
  // Misc XPCOM Interfaces

  onSourcesChanged: function() {
    this._getCollections();
    // Rebuild the view to reflect the new collection of messages.
    // Since the number of rows might have changed, we do this by reinitializing
    // the view instead of merely invalidating the box object (which doesn't
    // expect changes to the number of rows).
    this._buildCollectionTree();
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
    this._tree.view.selection.select(-1);

    if (this.isHierarchical) {
      this._rows = [collection for each (collection in this._collections)];
    }
    else {
      this._rows = [];
      for each (let collection in this._collections) {
        if (collection.grouped)
          for each (let group in collection.groups)
            this._rows.push(group);
        else
          this._rows.push(collection);
      }
    }

    this._tree.view = this;
  },

  onSelect: function(aEvent) {
    if (this._tree.currentIndex == -1 || SnowlUtils.gRightMouseButtonDown)
      return;

    let collection = this._rows[this._tree.currentIndex];
    SnowlUtils.gListViewCollectionIndex = this._tree.currentIndex;
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
    let selectedSourceIDs = [];
    let currentSourceID = this._rows[this._tree.currentIndex] ?
        this._rows[this._tree.currentIndex].groupID : null;
    let notifyID = null;

    // XXX: put in a loop for multiselected collections?
    let selectedSource = this._rows[SnowlUtils.gListViewCollectionIndex];

    if (!selectedSource.parent || selectedSource.parent.groupIDColumn != "sources.id")
      return;
this._log.info("unsubscribing source: "+selectedSource.name);

    selectedSourceIDs.push(selectedSource.groupID);

    // Delete loop here, if multiple selections..
    for (let i = 0; i < selectedSourceIDs.length; ++i) {
      sourceID = selectedSourceIDs[i];
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
        // Finally, delete the source
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM sources " +
            "WHERE id = " + sourceID);
        SnowlDatastore.dbConnection.commitTransaction();
      }
      catch(ex) {
        SnowlDatastore.dbConnection.rollbackTransaction();
        throw ex;
      }
      if (sourceID == currentSourceID)
        notifyID = sourceID;
    }

    Observers.notify("snowl:sources:changed");
    // If the current selection is unsubscribed, pass its id on to list view
    Observers.notify("snowl:messages:changed", notifyID);
  }

};

window.addEventListener("load", function() { CollectionsView.init() }, true);
