# Third-party material and exceptions

The MIT licence in `LICENSE` covers the code and documentation in this repository, with these exceptions:

- photos/: NASA imagery (images.nasa.gov), public domain, not covered by the
  MIT license above. Per-file credits are in photos/README.md.
- windhawk/*.yaml: Windhawk mod settings (data read by the GPL-3 Windhawk
  styler mods; the mods themselves are not included here). The element
  selectors in 02-start-menu-styler.yaml and 03-notification-center-styler.yaml
  were first collected from the TranslucentStartMenu / TranslucentShell
  themes in the ramensoftware styling guides, which carry no licence file;
  element names are factual Windows identifiers, and everything else in
  these files (colours, states, rules) was written for this project and is
  released under the MIT licence above. Thanks to m417z and the guide
  contributors.
- Fonts are loaded from Google Fonts at runtime (Inter, JetBrains Mono,
  Newsreader, Noto Sans SC), each under its own open licence; none is
  redistributed in this repository.
