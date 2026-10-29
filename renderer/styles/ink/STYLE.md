# Ink

Black ink line on white paper with a light grain. Almost no fills. Colour only where it means something.

- One idea per scene. The subject (Clawd and the prop, or the two sides of a compare) fills about half the frame and
  at least a third of the frame stays bare paper: one prop, or two for a compare, never a crowd.
- Settings are drawn as a light line hint, not a painted place: a horizon, a window and a floor, stars as dots, a sea
  line. Pick "none" or "room" when the place does not matter; "night" and "space" are white with dots, not dark.
- Colour grammar. Mark an element with a role only when the colour carries the meaning; everything else stays black:
  - "flow" (orange): what moves or passes on — light going through, a signal, a path; arrows are flow by default
  - "problem" (red): what is wrong, the danger, the old way, the mistake
  - "good" (blue): the answer, the fix, the good end
  Fields: "propRole" (the main prop), "left": {"role"} / "right": {"role"} in compare (a typical pair: problem on one
  side, good on the other), "labelRoles" (one per label: the arrow and its words), "captionRole" (the big words, only
  when the caption itself is the problem or the answer), "titleRole" (the end card title; good by default).
  At most one problem and one good per scene. Most scenes have no roles or one.
- "propColor" / "color" do nothing in this style: leave them out.
- Clawd stays terracotta (he is the brand) and is outlined in the same ink. Moves settle calmly; only landings bounce.
