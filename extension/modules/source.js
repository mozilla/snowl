const EXPORTED_SYMBOLS = ["SnowlSource"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

function SnowlSource(aID, aURL, aTitle) {
  this.id = aID;
  this.url = aURL;
  this.title = aTitle;
}

SnowlSource.prototype = {
  id: null,
  // FIXME: make this an nsIURI.
  url: null,
  title: null
};
