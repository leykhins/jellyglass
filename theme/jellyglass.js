/*
 * jellyglass — optional script for the My Media tiles.
 * Adds each library's three newest posters and its item count, matching the
 * design's poster stack. The theme works without it; tiles just show no posters.
 * Install with the JavaScript Injector plugin.
 */
(function () {
  "use strict";

  // What each library type counts, and how to label it
  var KINDS = {
    movies: { types: "Movie", one: "movie", many: "movies" },
    tvshows: { types: "Series", one: "show", many: "shows" },
    boxsets: { types: "BoxSet", one: "collection", many: "collections" },
    music: { types: "MusicAlbum", one: "album", many: "albums", square: true },
    books: { types: "Book", one: "book", many: "books" },
    homevideos: { types: "Video,Photo", one: "item", many: "items" },
    musicvideos: { types: "MusicVideo", one: "video", many: "videos" },
  };

  var cache = {};

  function api() {
    return window.ApiClient;
  }

  function fetchLibrary(card) {
    var id = card.getAttribute("data-id");
    var kind = KINDS[card.getAttribute("data-collectiontype")];
    if (!kind) return Promise.resolve(null);
    if (cache[id]) return cache[id];

    var client = api();
    var url = client.getUrl("Items", {
      userId: client.getCurrentUserId(),
      parentId: id,
      recursive: true,
      includeItemTypes: kind.types,
      sortBy: "DateCreated",
      sortOrder: "Descending",
      imageTypes: "Primary",
      fields: "PrimaryImageAspectRatio",
      limit: 3,
      enableTotalRecordCount: true,
    });

    cache[id] = client.getJSON(url).then(function (res) {
      var n = res.TotalRecordCount || 0;
      // Anime libraries are TV libraries, but the design counts them as series
      var isAnime = /anime/i.test(card.getAttribute("data-path") || "");
      var many = isAnime && kind.types === "Series" ? "series" : kind.many;
      var one = isAnime && kind.types === "Series" ? "series" : kind.one;
      return {
        count: n.toLocaleString() + " " + (n === 1 ? one : many),
        square: !!kind.square,
        posters: (res.Items || []).map(function (item) {
          return client.getScaledImageUrl(item.Id, {
            type: "Primary",
            maxHeight: 260,
            tag: item.ImageTags && item.ImageTags.Primary,
          });
        }),
      };
    }).catch(function () {
      delete cache[id];
      return null;
    });
    return cache[id];
  }

  function decorate(card) {
    if (card.hasAttribute("data-jg-done")) return;
    card.setAttribute("data-jg-done", "");

    fetchLibrary(card).then(function (lib) {
      if (!lib) return;
      card.setAttribute("data-jg-count", lib.count);
      var title = card.querySelector(".cardText-first");
      if (title) title.setAttribute("data-jg-count", lib.count);

      var host = card.querySelector(".cardImageContainer");
      if (!host || host.querySelector(".jg-stack") || !lib.posters.length) return;
      var stack = document.createElement("div");
      stack.className = "jg-stack" + (lib.square ? " is-square" : "");
      stack.setAttribute("aria-hidden", "true");
      // Oldest of the three at the back, newest in front
      lib.posters.slice().reverse().forEach(function (src) {
        var p = document.createElement("span");
        p.style.backgroundImage = 'url("' + src + '")';
        stack.appendChild(p);
      });
      host.appendChild(stack);
    });
  }

  function scan() {
    if (!api()) return;
    var cards = document.querySelectorAll(
      '.homeSectionsContainer .card[data-type="CollectionFolder"]:not([data-jg-done])'
    );
    for (var i = 0; i < cards.length; i++) decorate(cards[i]);
  }

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      scan();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  scan();
})();
