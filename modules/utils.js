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

const EXPORTED_SYMBOLS = ["SnowlDateUtils", "SnowlUtils"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/StringBundle.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");

let strings = new StringBundle("chrome://snowl/locale/utils.properties");

/**
 * Utilities for manipulating dates.
 *
 * FIXME: replace this with Datejs <http://www.datejs.com/>.
 */
let SnowlDateUtils = {
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

  days: {
    0: strings.get("sunday"),
    1: strings.get("monday"),
    2: strings.get("tuesday"),
    3: strings.get("wednesday"),
    4: strings.get("thursday"),
    5: strings.get("friday"),
    6: strings.get("saturday")
  },

  /**
   * Return the start and end times (inclusive) for the given date.
   *
   * @param date {Date} the date
   * @returns {Array} the start and end times
   */
  getDayBounds: function(date) {
    return [new Date(date.getFullYear(), date.getMonth(), date.getDate()),
            new Date(date.getFullYear(), date.getMonth(), date.getDate(),
                     23, 59, 59, 999)];
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
    get epoch() { return new Date(SnowlDateUtils.today - (SnowlDateUtils.msInDay * 2)) },
    get name() { return SnowlDateUtils.days[this.epoch.getDay()] }
  },

  threeDaysAgo: {
    get epoch() { return new Date(SnowlDateUtils.today - (SnowlDateUtils.msInDay * 3)) },
    get name() { return SnowlDateUtils.days[this.epoch.getDay()] }
  },

  fourDaysAgo: {
    get epoch() { return new Date(SnowlDateUtils.today - (SnowlDateUtils.msInDay * 4)) },
    get name() { return SnowlDateUtils.days[this.epoch.getDay()] }
  },

  fiveDaysAgo: {
    get epoch() { return new Date(SnowlDateUtils.today - (SnowlDateUtils.msInDay * 5)) },
    get name() { return SnowlDateUtils.days[this.epoch.getDay()] }
  },

  sixDaysAgo: {
    get epoch() { return new Date(SnowlDateUtils.today - (SnowlDateUtils.msInDay * 6)) },
    get name() { return SnowlDateUtils.days[this.epoch.getDay()] }
  },

  fourWeeksAgo: {
    // We calculate four weeks from the beginning of the day tomorrow
    // so that we include today in the four weeks.
    get epoch() { return new Date(SnowlDateUtils.tomorrow - (SnowlDateUtils.msInDay * 28)) },
    // XXX This name getter is actually never used, so maybe we should remove it.
    get name() { return SnowlDateUtils._formatDate(this.epoch) }
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
   * Various time periods broken up into subperiods.  Used by views to organize
   * messages into groups.
   * 
   * I wonder if it makes more sense to specify start/end times rather than
   * epochs (which are essentially start times). Among other benefits, we could
   * potentially eliminate unused epochs like "The Future" and (in some cases)
   * "Older" while fixing the bug that epochs never reached don't appear in views.
   *
   * XXX Can this code be consolidated with the today, yesterday, etc. getters
   * it references?
   */
  periods: {
    today: [
      { name: strings.get("evening"),   get epoch() { return SnowlDateUtils.evening(SnowlDateUtils.today) } },
      { name: strings.get("afternoon"), get epoch() { return SnowlDateUtils.afternoon(SnowlDateUtils.today) } },
      { name: strings.get("morning"),   get epoch() { return SnowlDateUtils.morning(SnowlDateUtils.today) } },
      { name: strings.get("weeHours"),  get epoch() { return SnowlDateUtils.today } }
    ],
    yesterday: [
      { name: strings.get("evening"),   get epoch() { return SnowlDateUtils.evening(SnowlDateUtils.yesterday) } },
      { name: strings.get("afternoon"), get epoch() { return SnowlDateUtils.afternoon(SnowlDateUtils.yesterday) } },
      { name: strings.get("morning"),   get epoch() { return SnowlDateUtils.morning(SnowlDateUtils.yesterday) } },
      { name: strings.get("weeHours"),  get epoch() { return SnowlDateUtils.yesterday } }
    ],
    last7days: [
      { name: strings.get("today"),                             get epoch() { return SnowlDateUtils.today } },
      { name: strings.get("yesterday"),                         get epoch() { return SnowlDateUtils.yesterday } },
      { get name() { return SnowlDateUtils.twoDaysAgo.name },   get epoch() { return SnowlDateUtils.twoDaysAgo.epoch } },
      { get name() { return SnowlDateUtils.threeDaysAgo.name }, get epoch() { return SnowlDateUtils.threeDaysAgo.epoch } },
      { get name() { return SnowlDateUtils.fourDaysAgo.name },  get epoch() { return SnowlDateUtils.fourDaysAgo.epoch } },
      { get name() { return SnowlDateUtils.fiveDaysAgo.name },  get epoch() { return SnowlDateUtils.fiveDaysAgo.epoch } },
      { get name() { return SnowlDateUtils.sixDaysAgo.name },   get epoch() { return SnowlDateUtils.sixDaysAgo.epoch } }
    ],
    last4weeks: [
      { name: strings.get("weekOne"),   get epoch() { return SnowlDateUtils.tomorrow - (SnowlDateUtils.msInDay * 7) } },
      { name: strings.get("weekTwo"),   get epoch() { return SnowlDateUtils.tomorrow - (SnowlDateUtils.msInDay * 14) } },
      { name: strings.get("weekThree"), get epoch() { return SnowlDateUtils.tomorrow - (SnowlDateUtils.msInDay * 21) } },
      { name: strings.get("weekFour"),  get epoch() { return SnowlDateUtils.tomorrow - (SnowlDateUtils.msInDay * 28) } }
    ],
    all: [
      { name: strings.get("today"),     get epoch() { return SnowlDateUtils.today } },
      { name: strings.get("yesterday"), get epoch() { return SnowlDateUtils.yesterday } },
      { name: strings.get("older"),     epoch: 0 }
    ]
  },

  /**
   * Format a date for display as a day (Today, Yesterday, 2009/06/13, etc.).
   * @param date {Date} the date to format
   * @returns a human-readable string representing the date
   */
  formatDay: function(date) {
    if (!date)
      return strings.get("unknownDate");

    let day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let now = new Date();
    let today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let yesterday = this.yesterday;

    if (day.getTime() == today.getTime())
      // FIXME: localize it.
      return strings.get("today");

    if (day.getTime() == yesterday.getTime())
      return strings.get("yesterday");

    // FIXME: pass in the locale.
    return this._dfSvc.FormatDate("",
                                  Ci.nsIScriptableDateFormat.dateFormatShort,
                                  day.getFullYear(),
                                  day.getMonth() + 1,
                                  day.getDate());
  },

  /**
   * Formats a date for human consumption using the date formatting service
   * for locale-specific formatting along with some additional smarts for more
   * human-readable representations of recent dates.
   * @param date {Date} the date to format
   * @returns a human-readable string representing the date
   */
  _formatDate: function(date) {
    if (!date)
      return strings.get("unknownDate");

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
    // FIXME: if it's at time 00:00:00, then leave off the time.
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
    if (day.getTime() == yesterday.getTime())
      return strings.get("yesterdayTime",
                         [this._dfSvc.FormatTime("",
                                                 Ci.nsIScriptableDateFormat.timeFormatNoSeconds,
                                                 date.getHours(),
                                                 date.getMinutes(),
                                                 null)]);

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

let SnowlUtils = {
  get _log() {
    let log = Log4Moz.repository.getLogger("Snowl.Utils");
    this.__defineGetter__("_log", function() { return log });
    return this._log;
  },

  //**************************************************************************//
  // Utilities to track tree selections within a session

  // Position of current page in tabs and history
  gMessagePosition: {tabIndex: null, pageIndex: null},

  // Track mouse and right mouse click for tree row onSelect, contextmenu, and
  // dnd handling without running a query resulting in content load.
  gRightMouseButtonDown: false,
  gMouseEvent: false,
  onTreeMouseDown: function(aEvent) {
    this.gMouseEvent = true;
    if (aEvent.button == 2)
      this.gRightMouseButtonDown = true;
    this.ChangeSelectionWithoutContentLoad(aEvent, aEvent.target.parentNode);
  },

  // Change the highlighted tree row to where the mouse was clicked (right
  // button for contextmenu or left button for mousedown dnd) without loading
  // the contents of the selected row.  The original row is indicated by the
  // dotted border (row at currentIndex).  Current active selected row (via
  // right or left click) is stored in new tree property currentSelectedIndex.
  ChangeSelectionWithoutContentLoad: function(aEvent, tree) {
    let treeBoxObj = tree.treeBoxObject;
    let treeSelection = treeBoxObj.view.selection;
    let saveCurrentIndex;
    let modKey = aEvent.metaKey || aEvent.ctrlKey || aEvent.shiftKey;
    let row = { }, col = { }, obj = { }, rangeFirst = { }, rangeLast = { };;

    treeBoxObj.getCellAt(aEvent.clientX, aEvent.clientY, row, col, obj);

    // Not for multiselection
    if (modKey)
      return;

    // Handle twisty click, don't let closed row be selected on multiselect.
    // Must make sure, on single visible item, that its currentIndex is valid
    // else closed state selection is wrong.  Lots of hoops with selection....
    if (obj.value == "twisty") {
      if (treeSelection.count > 1)
        treeSelection.currentIndex = -1;
      else if (treeSelection.count == 1 && treeSelection.currentIndex == -1) {
        treeSelection.getRangeAt(0, rangeFirst, rangeLast);
        treeSelection.currentIndex = rangeFirst.value;
      }

      return;
    }

    // Make sure that row.value is valid for the call to ensureRowIsVisible().
    if((row.value >= 0) && !treeSelection.isSelected(row.value) ||
        (treeSelection.isSelected(row.value) && treeSelection.currentIndex == -1)) {

      if (treeSelection.count > 1) {
        // If in multiselect, and not rt click on a selected row, just select the
        // rt click row..
        this.gRightMouseButtonDown = false;
        treeSelection.select(row.value);
      }
      else {
        if (treeSelection.count == 0)
          saveCurrentIndex = -1;
        else {
          // If no current index yet row selected, get first row in range.
          treeSelection.getRangeAt(0, rangeFirst, rangeLast);
          saveCurrentIndex = treeSelection.currentIndex == -1 ?
              rangeFirst.value : treeSelection.currentIndex;
        }
        treeSelection.selectEventsSuppressed = true;
        treeSelection.select(row.value);
        treeSelection.currentIndex = saveCurrentIndex;
        treeBoxObj.ensureRowIsVisible(row.value);
        treeSelection.selectEventsSuppressed = false;
        // Keep track of which row in the tree is currently selected via rt click,
        // onClick handler will update currentSelectedIndex for left click.
        if (this.gRightMouseButtonDown)
          tree.currentSelectedIndex = row.value;
      }
    }
    // This will not stop the onSelect event, need to test in the handler..
    aEvent.stopPropagation();
  },

  // All purpose function to make sure the right row is selected.  Restore the
  // original row currently indicated by dotted border without loading its query,
  // unless rows have been deleted/moved/inserted.  This is triggered when the
  // context menu for the row is hidden/closed (onpopuphidden event).
  RestoreSelection: function(aEvent, tree) {
    let treeSelection = tree.view.selection;
//this._log.info("RestoreSelection: curIndex:curSelectedIndex = "+
//  tree.currentIndex+" : "+tree.currentSelectedIndex);

    // Reset mouse state to enable key navigation.
    this.gMouseEvent = false;
    this.gRightMouseButtonDown = false;

    // No selection made, currentIndex may be 0 on autofocus, don't restore it.
    if (tree.currentSelectedIndex == -1)
      return;

    tree.currentSelectedIndex = treeSelection.currentIndex;
    // Make sure that currentIndex is valid so that we don't try to restore
    // a selection of an invalid row.
    if((!treeSelection.isSelected(treeSelection.currentIndex)) &&
        (treeSelection.currentIndex >= 0)) {
      treeSelection.selectEventsSuppressed = true;
      treeSelection.select(treeSelection.currentIndex);
      treeSelection.selectEventsSuppressed = false;
    }
    else if(treeSelection.currentIndex < 0) {
      // Clear the selection and border outline index.
      treeSelection.clearSelection();
      tree.currentSelectedIndex = -1;
    }
  },

  // Scroll tree to proper position.
  scrollPlacement: function(aTree, aRowIndex) {
    if (aTree.view.rowCount <= aTree.boxObject.getPageLength() ||
        (aRowIndex >= aTree.boxObject.getFirstVisibleRow() &&
          aRowIndex <= aTree.boxObject.getLastVisibleRow()) ||
        aRowIndex == -1)
      return;
    let excessRows = aTree.view.rowCount - aTree.view.selection.currentIndex;
    if (excessRows > aTree.boxObject.getPageLength())
      aTree.boxObject.scrollToRow(aRowIndex);
    else
      aTree.boxObject.scrollByPages(1);
  },


  // FIXME: put the following function into a generic SnowlMessageView
  // pure virtual class (i.e. an object rather than a function with a prototype)
  // from which SnowlMessageView instances inherit this functionality.

  /**
   * Append asterisks to the ends of words that don't already have one
   * appended to them to produce better results from a fulltext search.
   *
   * This implementation is naive because \w and \b only match ASCII words
   * and boundaries (bug 258974).  But SQLite's fulltext implementation
   * only supports ASCII at the moment anyway, so that's not a significant
   * limitation at the moment.
   *
   * There are two approaches here, one that appends asterisks to every word
   * and one that only appends them to unquoted words.  It's not clear to me
   * which one is better, since quoted strings are "phrase searches", and I
   * don't know whether users expect such searches to do exact matches (i.e.
   * "foo bar" only matches that exact string) or subword searches (i.e. it
   * also matches "foodies bartending").
   *
   * Or perhaps there's an even better third way, where we only append
   * an asterisk to the last word of a quoted string, so we don't match
   * "foodies bartending" but do match "foo bartholemew".  The reasoning
   * here is that we're doing a substring match, although we still can't
   * do a complete substring match because we can't prepend an asterisk
   * to the beginning of the first word (we could use LIKE, but that's
   * really expensive, because it does a full table scan).
   *
   * Then again, currently quotes are the only way to turn off subword
   * matches, so perhaps we should really preserve their current behavior
   * so that remains a possibility (and users can always append an asterisk
   * themselves inside a quoted string if they really want that behavior,
   * although it's not very discoverable).
   *
   * For the moment I'll append asterisks only to unquoted words but watch
   * for user feedback on possible improvements.
   */
  appendAsterisks: function(string) {
    let wordEnds = /\w\b(?!\*)/g;
    let asterisk = "$&*";

    // This version appends asterisks to every word.
    //return string.replace(wordEnds, asterisk);

    // This version appends asterisks to only unquoted words.  It does so
    // by searching for sequences of an optional quoted string followed by
    // an optional unquoted string followed by another optional quoted string,
    // i.e. (broken down into its three constituent components):
    //   ("[^"]*")?   // an optional quoted string
    //   ([^"]+)?     // an optional unquoted string 
    //   ("[^"]*")?   // another optional quoted string
    // It then calls a function on the search results that appends asterisks
    // to just the words in the unquoted string (if any).
    return string.replace(/("[^"]*")?([^"]+)?("[^"]*")?/g,
                          function(str, p1, p2, p3) p1 + p2.replace(wordEnds, asterisk) + p3);
  },


  //**************************************************************************//
  // Safe DOM Manipulation

  get _securityManager() {
    delete this._securityManager;
    return this._securityManager = Cc["@mozilla.org/scriptsecuritymanager;1"].
                                   getService(Ci.nsIScriptSecurityManager);
  },

  /**
   * Safely sets the URI attribute (f.e. "href") on a tag (f.e. the HTML <a>
   * tag), providing the URI specified can be loaded according to the rules.
   *
   * In particular, this prevents sources from linking to javascript: and data:
   * URLs that would run with chrome privileges in our various chrome-privileged
   * views.  It also prevents sources from linking to chrome: URLs.
   *
   * Based on the similar method in FeedWriter.js.
   *
   * @param   element     {Element}
   *          the element on which to set the attribute
   *
   * @param   attribute   {String}
   *          the name of the attribute to set, f.e. href or src
   *
   * @param   uri         {String}
   *          the URI to which to set the attribute
   *
   * @param   principal   {nsIPrincipal}
   *          the principal associated with the source of the URI
   */
  safelySetURIAttribute: function(element, attribute, uri, principal) {
    const flags = Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL;
    try {
      this._securityManager.checkLoadURIStrWithPrincipal(principal, uri, flags);
      // checkLoadURIStrWithPrincipal will throw if the URI shouldn't be loaded,
      // either because the source isn't allowed to load it or per the rules
      // specified in |flags|.
    }
    catch(ex) {
      // checkLoadURIStrWithPrincipal threw, so we don't set the attribute.
      return;
    }

    element.setAttribute(attribute, uri);
  },

  /**
   * A regex that matches URLs in text.  It correctly excludes punctuation
   * at the ends of URLs, so in the text "See http://example.com." it matches
   * "http://example.com", not "http://example.com.".  It is based on the regex
   * described in http://www.perl.com/doc/FMTEYEWTK/regexps.html.
   */
  get linkifyingRegex() {
    let protocols = "(?:" + ["http", "https", "ftp"].join("|") + ")";
    let ltrs = '\\w';
    let gunk = '/#~:.?+=&%@!\\-';
    let punc = '.:?\\-';
    let any  = ltrs + gunk + punc;

    let regex = new RegExp(
      "\\b(" + protocols + ":[" + any + "]+?)(?=[" + punc + "]*[^" + any + "]|$)",
      "gi"
    );

    delete this.linkifyingRegex;
    return this.linkifyingRegex = regex;
  },

  /**
   * Append text to an element, linkifying URLs embedded in it in the process.
   */
  linkifyText: function(text, container, principal) {
    let parts = text.split(this.linkifyingRegex);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 == 0)
        container.appendChild(container.ownerDocument.createTextNode(parts[i]));
      else {
        // This is a bit hacky.  In theory, I should need either a XUL
        // <description> tag of class="text-link" or an HTML <a> tag, but the
        // <description> tag opens a new window when you click on it,
        // and the <a> tag doesn't look like a link.  Using both results in
        // the correct appearance and behavior, although it's overcomplicated.
        // FIXME: figure out how to simplify this while making it look
        // and behave correctly.
        let desc = container.ownerDocument.createElementNS(XUL_NS, "description");
        desc.className = "text-link";
        let a = container.ownerDocument.createElementNS(HTML_NS, "a");
        this.safelySetURIAttribute(a, "href", parts[i], principal);
        a.appendChild(container.ownerDocument.createTextNode(parts[i]));
        desc.appendChild(a);
        container.appendChild(desc);
      }
    }
  },

  /**
   * Canonicalize the feeds provided by a web page by removing probable
   * duplicates that use different protocols (Atom, RSS) and titling them
   * after the page itself, since we treat feeds as the transport protocol
   * for updates from web pages, so the web page itself is the first-class
   * object to which we expose users, and its title is the more memorable
   * in that regard.
   *
   * @param   feeds       {Array}
   *          the feeds to canonicalize; each element is a feed {Object}
   *          with two properties:
   *            href  {String} URL of the feed
   *            title {String} title of the feed
   *
   * @param   pageTitle   {String}
   *          title of page providing the feeds
   *
   * @returns {Array} canonicalized array of feeds
   */
  canonicalizeFeeds: function(feeds, pageTitle) {
    // Operate on a copy of the feeds array so we don't hork other extensions
    // or core code that expect that array to remain intact.
    let canonicalFeeds = feeds.concat();

    if (canonicalFeeds.length == 1) {
      this._log.trace("canonicalizeFeeds: one feed");

      // If the page title is available, name the feed after the page,
      // as the page's title is likely to be better than the feed title.
      if (pageTitle)
        canonicalFeeds[0].title = pageTitle;
    }
    else if (canonicalFeeds.length == 2) {
      this._log.trace("canonicalizeFeeds: two feeds");

      // If the two feeds appear to be duplicates (i.e. one RSS, the other
      // Atom), then remove one.  We remove the RSS feed by default, assuming
      // that the Atom feed is better because Atom is better specified, but we
      // could just as well remove the Atom feed if the RSS feed seems better
      // under certain circumstances.
      let areDupes = function(a, b) (/atom/i.test(a) && /rss/i.test(b)) ||
                                    (/atom/i.test(b) && /rss/i.test(a));
      if (areDupes(canonicalFeeds[0].title, canonicalFeeds[1].title)) {
        this._log.trace("canonicalizeFeeds: the two feeds are dupes");

        // This code is overly complicated (filtering to an array, extracting
        // its first element, and then putting that into another array)
        // to ensure we always reduce the array to a single element even if
        // both of their names happen to contain the string "atom"
        // (f.e. if one was called "Atom Feed" and the other was called
        // "RSS Feed - Not Atom").
        canonicalFeeds =
          [canonicalFeeds.filter(function(v) /atom/i.test(v.title))[0]];
      }

      // If the page title is available, name the feed after the page,
      // as the page's title is likely to be better than the feed title.
      if (pageTitle)
        canonicalFeeds[0].title = pageTitle;
    }
    else {
      this._log.trace("canonicalizeFeeds: more than two feeds");

      // If there are more than two feeds, we don't currently do anything.
      // Perhaps there are things we could do?  Use cases would be handy.
    }

    return canonicalFeeds;
  },

  /**
   * Canonicalize feeds provided by multiple web pages.  This calls
   * canonicalizeFeeds on the feeds for each individual page, then it removes
   * any exact duplicates from the list, so if you generate a list of feeds
   * from a set of pages (f.e. pages open in tabs), and you have the same page
   * in the set twice (or two pages from the same site that both provide
   * the same feeds), you don't get duplicate feeds.
   *
   * @param   pages {Array}
   *          the pages to canonicalize; each element is a page {Object}
   *          with two properties:
   *            feeds {Array}  the feeds to canonicalize (@see canonicalizeFeeds
   *                           for a description of feed objects)
   *            title {String} the title of the page
   *
   * @returns {Array} canonicalized array of feeds
   */
  canonicalizeFeedsFromMultiplePages: function(pages) {
    let feeds = [];

    // Convert the array of pages into an array of feeds from those pages
    // which have been canonicalized with respect to each individual page.
    for each (let page in pages)
      feeds = feeds.concat(this.canonicalizeFeeds(page.feeds, page.title));

    // We can do the above with a single statement, but I don't think we gain
    // anything, since I can't find a way to make the statement more compact
    // while retaining readability.
    //feeds = 
    //  pages.map(function(page) this.canonicalizeFeeds(page.feeds, page.title),
    //            this).reduce(function(feeds, feed) feeds.concat(feed), []);

    // Convert the array of feeds into an array of feeds that have been
    // canonicalized with respect to the set of pages as a whole (i.e. remove
    // exact duplicates from the list of feeds from all pages).  We consider
    // two feeds to be duplicates if their URLs match, even if their titles
    // are different, since users only benefit from subscribing to any given
    // feed once, even if the feed is offered by two different pages
    // with different titles.
    let uniqueFeeds = {};
    for each (let feed in feeds)
      uniqueFeeds[feed.href] = feed;
    feeds = [feed for ([, feed] in Iterator(uniqueFeeds))];

    // We can do the above with a single statement, but I don't think we gain
    // anything, since I can't find a way to make the statement more compact
    // while retaining readibility.  I suppose there's benefit to not having
    // to declare the temporary uniqueFeeds object.
    //feeds = [feed for ([, feed] in
    //  Iterator(feeds.reduce(function(uniqueFeeds, feed) {
    //                          uniqueFeeds[feed.href] = feed; return uniqueFeeds
    //                        }, {})))];

    return feeds;
  }

};
