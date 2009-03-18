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
 *   alta88 <alta@gmail.com>
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

const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/URI.js");

/**
 * BookmarkPropertiesPanel overrides here.
 */
BookmarkPropertiesPanel.Places_fillAddProperties =
  BookmarkPropertiesPanel._fillAddProperties;

BookmarkPropertiesPanel._fillAddProperties =
  function BPP__fillAddProperties() {
    let dialogInfo = window.arguments[0];
    if ("mode" in dialogInfo && dialogInfo.mode == "view") {
//this._log.info("_fillAddProperties: custom START");
      this._mode = dialogInfo.mode;
      document.title = this._title;
      this._createNewView();
      // Edit the new item
      gEditItemOverlay.initPanel(this._itemId, { hiddenRows: this._hiddenRows });
//this._log.info("_fillAddProperties: custom END");
      return;
    }

  this.Places_fillAddProperties();
};

BookmarkPropertiesPanel.Places_onDialogAccept =
  BookmarkPropertiesPanel.onDialogAccept;

BookmarkPropertiesPanel.onDialogAccept =
  function BPP__onDialogAccept() {
    // Update names for a View or Source/Author item.
    SnowlPlaces.renamePlace(this._itemId,
                            this._uri.spec,
                            this._element("userEnteredName").label);

    this.Places_onDialogAccept();
};

/**
 * BookmarkPropertiesPanel new functions here.
 */

BookmarkPropertiesPanel._log = Log4Moz.repository.getLogger("Snowl.BookmarkProperties");
BookmarkPropertiesPanel._mode = null;

/**
 * Returns a transaction for creating a new view folder item and shortcut.
 * A custom view is a folder with a view anno; the view anno is used to create
 * all folder shortcuts which are visible in the 'default' menulist; all shortcuts
 * have an anno that allows them to be added to the menulist dynamically.
 */
BookmarkPropertiesPanel._createNewView =
  function BPP__getCreateViewTransaction() {
    var txn = this._getCreateNewViewFolderTransaction(SnowlPlaces.userRootID,
                                                      SnowlPlaces.DEFAULT_INDEX);
    PlacesUIUtils.ptm.doTransaction(txn);
    this._itemId = PlacesUtils.bookmarks.getIdForItemAt(SnowlPlaces.userRootID,
                                                        SnowlPlaces.DEFAULT_INDEX);
//this._log.info("_createNewView: folder itemid:title - "+this._itemId+" : "+this._title);

    var txn = this._getCreateNewViewShortcutTransaction(SnowlPlaces.collectionsSystemID,
                                                        SnowlPlaces.DEFAULT_INDEX);
    PlacesUIUtils.ptm.doTransaction(txn);
    this._itemId = PlacesUtils.bookmarks.getIdForItemAt(SnowlPlaces.collectionsSystemID,
                                                        SnowlPlaces.DEFAULT_INDEX);
//this._log.info("_createNewView: shortcut itemid:title - "+this._itemId+" : "+this._title);
};

/**
 * Returns a transaction for creating a new view folder.  The folder is added to
 * the User root and part of the Places .json backup system.  The base view folder
 * container is not visible itself, but viewed via its shortcut in the tree.
 * The folder's children are shown via a place attribute query when its menulist
 * item is selected.
 */
BookmarkPropertiesPanel._getCreateNewViewFolderTransaction =
  function BPP__getCreateNewViewFolderTransaction(aContainer, aIndex) {
    let childItemsTransactions;
    let annotations = [{ name: SnowlPlaces.SNOWL_USER_VIEW_ANNO,
                         type: Ci.nsIAnnotationService.TYPE_STRING,
                         flags: 0,
                         value: "snowlUserView",
                         expires: Ci.nsIAnnotationService.EXPIRE_NEVER }];

    return PlacesUIUtils.ptm.createFolder("snowlUserView:" + this._title,
                                          aContainer,
                                          aIndex,
                                          annotations,
                                          childItemsTransactions);
};

/**
 * Returns a transaction for creating a shortcut.  The first anno can be used to
 * style icons using .css with the value name.  The second anno is used to build
 * the View menulist; the value must be the itemId of the base folder.
 */
BookmarkPropertiesPanel._getCreateNewViewShortcutTransaction =
  function BPP___getCreateNewViewShortcutTransaction(aContainer, aIndex) {
    let annotations = [{ name: SnowlPlaces.ORGANIZER_QUERY_ANNO,
                         type: Ci.nsIAnnotationService.TYPE_STRING,
                         flags: 0,
                         value: "snowl-" + this._title,
                         expires: Ci.nsIAnnotationService.EXPIRE_NEVER },
                       { name: SnowlPlaces.SNOWL_USER_VIEWLIST_ANNO,
                         type: Ci.nsIAnnotationService.TYPE_STRING,
                         flags: 0,
                         value: this._itemId,
                         expires: Ci.nsIAnnotationService.EXPIRE_NEVER }];

    if (this._description)
      annotations.push(this._getDescriptionAnnotation(this._description));

    return PlacesUIUtils.ptm.createItem(URI("place:folder=" + this._itemId),
                                        aContainer,
                                        aIndex,
                                        this._title,
                                        null,
                                        annotations,
                                        null);
};
