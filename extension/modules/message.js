const EXPORTED_SYMBOLS = ["SnowlMessage"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

function SnowlMessage(aID, aSubject, aAuthor, aLink, aTimestamp, aRead) {
  this.id = aID;
  this.subject = aSubject;
  this.author = aAuthor;
  this.link = aLink;
  this.timestamp = aTimestamp;
  this.read = aRead;
}

SnowlMessage.prototype = {
  id: null,
  subject: null,
  author: null,
  link: null,
  timestamp: null,
  read: null
};
