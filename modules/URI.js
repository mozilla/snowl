const EXPORTED_SYMBOLS = ["URI"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

/**
 * A URI.  For now, this returns an nsIURI rather than an instance of this
 * class, but in the future it might return an instance of this class and have
 * a more JS-friendly API for accessing and manipulating the URI.
 */
function URI(aSpec, aCharset, aBaseURI) {
  return URI.ioSvc.newURI(aSpec, aCharset, aBaseURI);
}

/**
 * Get a URI.  Similar to the constructor, but returns null instead of throwing
 * an exception if the URI object could not be constructed.
 */
URI.get = function(aSpec, aCharset, aBaseURI) {
  try {
    return new URI(aSpec, aCharset, aBaseURI);
  }
  catch(ex) {
    return null;
  }
};

URI.__defineGetter__("ioSvc",
  function() {
    let ioSvc = Cc["@mozilla.org/network/io-service;1"].
                getService(Ci.nsIIOService);
    delete this.ioSvc;
    this.ioSvc = ioSvc;
    return this.ioSvc;
  }
);
