# LucasCoupe modeling exercise

The editable project is `examples/LucasCoupe.lucascad.json`; a STEP export and a
diagnostic render are beside it. `examples/build_coupe.py` reproduces the project
using existing LucasCad feature records and the application's rebuild kernel.
This exercise generated the records programmatically; it was not a complete
mouse-driven usability test. Chrome's native file picker prevented automated
import, so final in-app inspection remains pending.

## Model

- 220 mm concept coupe, with +X pointing toward the front and +Z upward.
- Seven-section lofted body, through-cut wheel arches, shelled cabin, four side
  windows, windshield and rear-window openings.
- Four revolved tires, five-spoke rims and hubs, lights, grille recess and sills.
- 51 sketches, 46 features and 16 valid solids. No imported mesh features.
- Body and cabin are separate overlapping solids, not an assembly. There is no
  glass, suspension or detailed interior.

## Verified

- Every resulting body is a valid single solid.
- All four tires have zero volumetric interference with the lower body.
- Window probes through both side-window pairs encounter no cabin material.
- All four lamps touch the bodywork.
- STEP re-import produces 16 solids.
- The preview was rendered from the actual rebuilt solids with depth testing.
  Its body colors are diagnostic render colors, not saved LucasCad appearances.

## Most valuable next improvements

1. **Body/feature Mirror and 3D Pattern.** The four wheel assemblies currently
   require repeated features. One seed assembly with linked copies would reduce
   repetition and make wheel changes much easier. Both
   [SolidWorks](https://help.solidworks.com/2026/english/SolidWorks/sldworks/c_Mirror_Feature_Overview.htm)
   and [Onshape](https://cad.onshape.com/help/Content/PartStudio/mirror.htm)
   support mirroring at the feature/body or part level.
2. **Loft guide curves and end conditions.** The current section loft makes a
   useful concept body, but is insufficient for deliberate automotive surface
   transitions. This is a larger modeling-kernel and interaction-design choice.
3. **Per-body appearances.** Tires, rims and body panels need differentiation
   in the native viewport, not just an external diagnostic render.
4. **Feature-tree folders and filters.** A model with this many sketches and
   features needs grouping for wheels, cabin and bodywork.

Face-index-based references also deserve a topology-change regression exercise;
they are a design risk, not a failure demonstrated by this model. Assembly/mate
support would be a separate major development direction, not a prerequisite for
the initial body-level pattern tool.
