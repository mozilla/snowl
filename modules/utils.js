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

const EXPORTED_SYMBOLS = ["SnowlUtils"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let SnowlUtils = {
  jsToJulianDate: function(date) {
    // Divide by 1000 to get seconds since Unix epoch, divide by 86400
    // to get days since Unix epoch, add the difference between the Unix epoch
    // and the Julian epoch.
    return date.getTime() / 1000 / 86400 + 2440587.5;
  },

  julianToJSDate: function(date) {
    // Invert the function in jsToJulianDate, but round its result before
    // constructing a Date object, as the Date object would truncate (floor)
    // the non-integer result of the calculation, potentially resulting in
    // an off-by-one error.
    return new Date(Math.round((date - 2440587.5) * 86400 * 1000));
  },

  // Date Formatting Service
  get _dfSvc() {
    delete this._dfSvc;
    return this._dfSvc = Cc["@mozilla.org/intl/scriptabledateformat;1"].
                         getService(Ci.nsIScriptableDateFormat);
  },

  /**
   * Formats a date for human consumption using the date formatting service
   * for locale-specific formatting along with some additional smarts for more
   * human-readable representations of recent dates.
   * @param date {Date} the date to format
   * @returns a human-readable string representing the date
   */
  _formatDate: function(date) {
    let result;

    let now = new Date();

    let today = new Date(now.getFullYear(), now.getMonth, now.getDate());

    let yesterday = new Date(now - 24 * 60 * 60 * 1000);
    yesterday = new Date(yesterday.getFullYear(),
                         yesterday.getMonth(),
                         yesterday.getDate());

    let sixDaysAgo = new Date(now - 6 * 24 * 60 * 60 * 1000);
    sixDaysAgo = new Date(sixDaysAgo.getFullYear(),
                          sixDaysAgo.getMonth(),
                          sixDaysAgo.getDate());

    if (date.toLocaleDateString() == now.toLocaleDateString())
      result = this._dfSvc.FormatTime("",
                                      this._dfSvc.timeFormatNoSeconds,
                                      date.getHours(),
                                      date.getMinutes(),
                                      null);
    else if (date > yesterday)
      result = "Yesterday " + this._dfSvc.FormatTime("",
                                                     this._dfSvc.timeFormatNoSeconds,
                                                     date.getHours(),
                                                     date.getMinutes(),
                                                     null);
    else if (date > sixDaysAgo)
      result = this._dfSvc.FormatDateTime("",
                                          this._dfSvc.dateFormatWeekday, 
                                          this._dfSvc.timeFormatNoSeconds,
                                          date.getFullYear(),
                                          date.getMonth() + 1,
                                          date.getDate(),
                                          date.getHours(),
                                          date.getMinutes(),
                                          date.getSeconds());
    else
      result = this._dfSvc.FormatDateTime("",
                                          this._dfSvc.dateFormatShort, 
                                          this._dfSvc.timeFormatNoSeconds,
                                          date.getFullYear(),
                                          date.getMonth() + 1,
                                          date.getDate(),
                                          date.getHours(),
                                          date.getMinutes(),
                                          date.getSeconds());

    return result;
  }

};
