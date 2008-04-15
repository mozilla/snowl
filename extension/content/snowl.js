var Snowl = {
  init: function() {
    SnowlView.onLoad();
  },

  toggleView: function() {
    let container = document.getElementById("snowlViewContainer");
    let splitter = document.getElementById("snowlViewSplitter");
    if (container.hidden) {
      container.hidden = false;
      splitter.hidden = false;
    }
    else {
      container.hidden = true;
      splitter.hidden = true;
    }
  }

};

window.addEventListener("load", function() { Snowl.init() }, false);
