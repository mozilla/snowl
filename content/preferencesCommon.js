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

let SnowlPreferencesCommon = {
  //**************************************************************************//
  // Functions that are shared between Options dialog and Properties dialog.

  _: function(aID) {
    return document.getElementById(aID);
  },

  _queryId: null,
  _sourceType: null,

  // Type of source, default attribute values.
  SourceType: null,
  // This message source.
  Source: null,

  onPaneLoad: function() {
    // On preferences dialog load.
    this._sourceType = this._("settingsRadio").selectedItem.value;
    this.SourceType = SnowlService._accountTypesByType[this._sourceType];
    this.Source = this.SourceType;

    this._("refreshStatusBox").hidden = true;
    this._("refresh.useDefault").label = SnowlPreferences._strings.get("settingsDefaultText");
    this._("retention.useDefault").label = SnowlPreferences._strings.get("settingsDefaultText");

    this.initSettings();
    this.onCheckKeepMsg();
  },

  initProperties: function(aQueryId, aName) {
    // On properties dialog load.
    this._queryId = aQueryId;
    this.Source = SnowlService.sourcesByID[this._queryId];

    if (!this.Source) {
      this._log.error(aName + ", places id " + this._queryId +
                      ", is not found - remove this source or rebuild database.");
      this._("bookmarkproperties").cancelDialog();
      return;
    }

    this._sourceType = this.Source.constructor.name;
    this.SourceType = SnowlService._accountTypesByType[this._sourceType];

    this.initSettings();
    this._("refreshState").value = this.Source.attributes.refresh["status"];
    this._("refreshDate").value = SnowlDateUtils._formatDate(this.Source.lastRefreshed);
    this._("refreshCode").value = this.Source.attributes.refresh["code"];
    this._("refreshError").value = this.Source.attributes.refresh["text"];
  },

  initSettings: function() {
    // Refresh settings.
    if ("refresh" in this.Source.attributes &&
        "useDefault" in this.Source.attributes.refresh &&
        !this.Source.attributes.refresh["useDefault"])
      this._("refresh.useDefault").checked = false;
    else
      this._("refresh.useDefault").checked = true;

    if ("refresh" in this.Source.attributes &&
        "interval" in this.Source.attributes.refresh)
      this._("refresh.minutes").value =
          this.Source.attributes.refresh["interval"] / 1000 / 60;
    else
      this._("refresh.minutes").value =
          this.SourceType.attributes.refresh["interval"] / 1000 / 60;

    this.onUseDefaultRefreshSettings();

    // Retention settings.
    if ("retention" in this.Source.attributes &&
        "useDefault" in this.Source.attributes.retention &&
        !this.Source.attributes.retention["useDefault"])
      this._("retention.useDefault").checked = false;
    else
      this._("retention.useDefault").checked = true;

    if ("retention" in this.Source.attributes &&
        "deleteBy" in this.Source.attributes.retention)
      this._("retention.keepMsg").value =
          this.Source.attributes.retention["deleteBy"];
    else
      this._("retention.keepMsg").value =
          this.SourceType.attributes.retention["deleteBy"];

    if ("retention" in this.Source.attributes &&
        "deleteDays" in this.Source.attributes.retention)
      this._("retention.keepNewMsgMin").value =
          this.Source.attributes.retention["deleteDays"];
    else
      this._("retention.keepNewMsgMin").value =
          this.SourceType.attributes.retention["deleteDays"];

    if ("retention" in this.Source.attributes &&
        "deleteNumber" in this.Source.attributes.retention)
      this._("retention.keepOldMsgMin").value =
          this.Source.attributes.retention["deleteNumber"];
    else
      this._("retention.keepOldMsgMin").value =
          this.SourceType.attributes.retention["deleteNumber"];

    if ("retention" in this.Source.attributes &&
        "keepFlagged" in this.Source.attributes.retention)
      this._("retention.keepFlagged").checked =
          this.Source.attributes.retention["keepFlagged"];
    else
      this._("retention.keepOldMsgMin").value =
          this.SourceType.attributes.retention["keepFlagged"];

    this.onUseDefaultRetentionSettings();
  },

  onUseDefaultRefreshSettings: function() {
    if (!this._queryId)
      // Not for source type preferences.
      return;

    let useDefault = document.getElementById("refresh.useDefault").checked;
    this._('refreshMinutes').disabled = useDefault;
    this._('refresh.minutes').disabled = useDefault;
    this._('refresh.minutesLabel').disabled = useDefault;
  },

  onUseDefaultRetentionSettings: function() {
    if (!this._queryId)
      // Not for source type preferences.
      return;

    let useDefault = document.getElementById("retention.useDefault").checked;
    this._('retention.keepMsg').disabled = useDefault;
    this._('retention.keepNewMsgMinLabel').disabled = useDefault;
    this._('retention.keepOldMsgMinLabel').disabled = useDefault;

    let keepMsg = document.getElementById("retention.keepMsg").value;
    this._('retention.keepNewMsgMin').disabled = useDefault || keepMsg != 1;
    this._('retention.keepOldMsgMin').disabled = useDefault || keepMsg != 2;
  },

  onCheckKeepMsg: function() {
    var keepMsg = document.getElementById("retention.keepMsg").value;
    this._("retention.keepNewMsgMin").disabled = keepMsg != 1;
    this._("retention.keepOldMsgMin").disabled = keepMsg != 2;
  },

  persistProperties: function(aQueryId) {
    this.Source.attributes.refresh["useDefault"] = this._("refresh.useDefault").checked;
    this.Source.attributes.refresh["interval"] = this._("refresh.minutes").value * 1000 * 60;
    this.Source.attributes.retention["useDefault"] = this._("retention.useDefault").checked;
    this.Source.attributes.retention["deleteBy"] = this._("retention.keepMsg").selectedIndex;
    this.Source.attributes.retention["deleteDays"] = this._("retention.keepNewMsgMin").valueNumber;
    this.Source.attributes.retention["deleteNumber"] = this._("retention.keepOldMsgMin").valueNumber;
    this.Source.attributes.retention["keepFlagged"] = this._("retention.keepFlagged").checked;
    this.Source.persistAttributes();
    if (this._queryId)
      // An individual source.
      SnowlService.sourcesByID[this._queryId].attributes = this.Source.attributes;
    else
      // A source type.
      SnowlService._accountTypesByType[this._sourceType = this.Source.attributes];
  }

}
