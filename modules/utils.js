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

// FIXME: rename this to reflect the fact that it's date-specific rather than
// being a generic set of utilities.
let SnowlUtils = {
  get msInHour() 1000 * 60 * 60,

  get msInDay() this.msInHour * 24,

  jsToJulianDate: function(date) {
    // Sometimes we don't have a date.  We represent that the same way
    // for both JS and Julian dates.
    if (date == null)
      return null;

    // Divide by 1000 to get seconds since Unix epoch, divide by 86400
    // to get days since Unix epoch, add the difference between the Unix epoch
    // and the Julian epoch.
    return date.getTime() / 1000 / 86400 + 2440587.5;
  },

  julianToJSDate: function(date) {
    // Sometimes we don't have a date.  We represent that the same way
    // for both JS and Julian dates.
    if (date == null)
      return null;

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

  // FIXME: make this localizable.
  days: {
    0: "Sunday",
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday"
  },

  // FIXME: accommodate daylight savings time (DST), which could cause
  // these calculations to be incorrect at times (the current implementation
  // is naive and ignores the existence of DST).

  // tomorrow, today, and yesterday return an epoch; twoDaysAgo etc. return
  // an object that has epoch and name properties; while evening, afternoon,
  // and morning take a Date object and return an epoch.
  // FIXME: make the API consistent.

  // I wonder if it makes sense to define (or borrow) a domain-specific language
  // for doing date calculations.  Another option would be to add methods
  // to the Date object for adding and subtracting time.  We might even be able
  // to confine such modifications to Date objects created within this module,
  // since each module gets its own set of standard global objects.  Or we could
  // hang stuff off a SnowlDate object that inherits from Date.

  get tomorrow() {
    // We can't just add the right number of milliseconds to new Date() here
    // because JavaScript will interpret the plus sign as string concatenation,
    // so we have to explicitly call getTime() on the date object.
    let sometimeTomorrow = new Date(new Date().getTime() + (1000 * 60 * 60 * 24));
    return new Date(sometimeTomorrow.getFullYear(),
                    sometimeTomorrow.getMonth(),
                    sometimeTomorrow.getDate());
  },

  get today() {
    let sometimeToday = new Date();
    return new Date(sometimeToday.getFullYear(),
                    sometimeToday.getMonth(),
                    sometimeToday.getDate());
  },

  get yesterday() {
    let sometimeYesterday = new Date(new Date() - (1000 * 60 * 60 * 24));
    return new Date(sometimeYesterday.getFullYear(),
                    sometimeYesterday.getMonth(),
                    sometimeYesterday.getDate());
  },

  twoDaysAgo: {
    get epoch() { return new Date(SnowlUtils.today - (SnowlUtils.msInDay * 2)) },
    get name() { return SnowlUtils.days[this.epoch.getDay()] }
  },

  threeDaysAgo: {
    get epoch() { return new Date(SnowlUtils.today - (SnowlUtils.msInDay * 3)) },
    get name() { return SnowlUtils.days[this.epoch.getDay()] }
  },

  fourDaysAgo: {
    get epoch() { return new Date(SnowlUtils.today - (SnowlUtils.msInDay * 4)) },
    get name() { return SnowlUtils.days[this.epoch.getDay()] }
  },

  fiveDaysAgo: {
    get epoch() { return new Date(SnowlUtils.today - (SnowlUtils.msInDay * 5)) },
    get name() { return SnowlUtils.days[this.epoch.getDay()] }
  },

  sixDaysAgo: {
    get epoch() { return new Date(SnowlUtils.today - (SnowlUtils.msInDay * 6)) },
    get name() { return SnowlUtils.days[this.epoch.getDay()] }
  },

  twentySevenDaysAgo: {
    get epoch() { return new Date(SnowlUtils.today - (SnowlUtils.msInDay * 27)) },
    get name() { return "Twenty Seven Days Ago" }
  },

  evening: function(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 18);
  },

  afternoon: function(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  },

  morning: function(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6);
  },

  /**
   * Formats a date for human consumption using the date formatting service
   * for locale-specific formatting along with some additional smarts for more
   * human-readable representations of recent dates.
   * @param date {Date} the date to format
   * @returns a human-readable string representing the date
   */
  _formatDate: function(date) {
    // FIXME: make this localizable.
    if (!date)
      return "unknown date";

    let day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let now = new Date();
    let today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let yesterday = this.yesterday;

    let sixDaysAgo = new Date(now - 1000 * 60 * 60 * 24 * 6);
    sixDaysAgo = new Date(sixDaysAgo.getFullYear(),
                          sixDaysAgo.getMonth(),
                          sixDaysAgo.getDate());

    // If it's in the future or more than six days in the past, format it
    // as a full date/time string, i.e.: 2008-05-13 15:37:42.
    if (day > today || day < sixDaysAgo)
      return this._dfSvc.FormatDateTime("",
                                        Ci.nsIScriptableDateFormat.dateFormatShort,
                                        Ci.nsIScriptableDateFormat.timeFormatNoSeconds,
                                        date.getFullYear(),
                                        date.getMonth() + 1,
                                        date.getDate(),
                                        date.getHours(),
                                        date.getMinutes(),
                                        date.getSeconds());

    // If it's today, only show the time.
    if (day.getTime() == today.getTime())
      return this._dfSvc.FormatTime("",
                                    Ci.nsIScriptableDateFormat.timeFormatNoSeconds,
                                    date.getHours(),
                                    date.getMinutes(),
                                    null);

    // If it's yesterday, show "Yesterday" plus the time.
    // FIXME: make this localizable.
    if (day.getTime() == yesterday.getTime())
      return "Yesterday " +
             this._dfSvc.FormatTime("",
                                    Ci.nsIScriptableDateFormat.timeFormatNoSeconds,
                                    date.getHours(),
                                    date.getMinutes(),
                                    null);

    // It's two to six days ago, so show the day of the week plus the time.
    return this._dfSvc.FormatDateTime("",
                                      Ci.nsIScriptableDateFormat.dateFormatWeekday, 
                                      Ci.nsIScriptableDateFormat.timeFormatNoSeconds,
                                      date.getFullYear(),
                                      date.getMonth() + 1,
                                      date.getDate(),
                                      date.getHours(),
                                      date.getMinutes(),
                                      date.getSeconds());
  }

};
