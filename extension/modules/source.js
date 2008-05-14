const EXPORTED_SYMBOLS = ["SnowlSource"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

function SnowlSource(aID, aURL, aTitle, aLastRefreshed, aImportance) {
  this.id = aID;
  this.url = aURL;
  this.title = aTitle;
  this.lastRefreshed = aLastRefreshed;
  this.importance = aImportance;
}

SnowlSource.prototype = {
  id: null,

  // FIXME: make this an nsIURI.
  // FIXME: differentiate between the machine representation of the source
  // (the RSS/Atom feed file, the IMAP/POP server) and its human representation
  // (the website publishing the feed, the web interface to the mail server)
  // by providing two URLs, one for each representation.
  url: null,

  // FIXME: rename this property to name.
  title: null,

  // A JavaScript Date object representing the last time this source was
  // checked for updates to its set of messages.
  lastRefreshed: null,

  // An integer representing how important this source is to the user
  // relative to other sources to which the user is subscribed.
  importance: null
};
