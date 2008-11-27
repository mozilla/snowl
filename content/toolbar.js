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

Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/opml.js");

let SnowlToolbar = {
  subscribe: function(event) {
    // The subscriptions interface has been moved to the options dialog,
    // so open the options dialog when the user presses the subscribe button.
    // Note: even though we open this in a tab, it will cause the Preferences
    // dialog to open.  Ultimately the subscriptions interface will be in its
    // own dialog and we'll directly open that dialog here (see the code
    // in options.xul for how to open it).
    gBrowserWindow.gBrowser.selectedTab =
      gBrowserWindow.gBrowser.addTab("chrome://snowl/content/options.xul");
  },

  // FIXME: make this work again.
  // FIXME: make this not be specific to the tree in the collections view.
  unsubscribe: function(aEvent) {
    CollectionsView.unsubscribe();
  },

  // FIXME: make this be context-specific, so if we're viewing a single source
  // it only refreshes that source, etc.
  onRefresh: function() {
    SnowlService.refreshAllSources();
  },

  onExportOPML: function() {
    SnowlOPML.export(window);
  },

  onToggleWrite: function(event) {
    SnowlMessageView.onToggleWrite(event);
  }
};
