# GeoField workspace data model

## Scope

This is the versioned domain model foundation for multi-project fieldwork. It deliberately does not change the current encrypted storage payload or visible app screens yet. That separation prevents an unverified schema change from making existing field records inaccessible.

## Workspace schema v1

A workspace contains four top-level properties:

- `schemaVersion`: integer version for explicit, testable migrations.
- `projects`: project metadata (name, code, client, area, description, timestamps).
- `observations`: the existing geological observation objects, extended with a required `projectId`.
- `samples`: sample register entries with project and optional observation references.

Each collection has unique stable IDs. Observation and sample references must resolve to an existing project; sample observation references must resolve to an existing observation. Collection limits are enforced before persistence.

## Legacy compatibility

`migrateLegacyRecords()` converts the existing flat observation array into a workspace and assigns every imported observation to one clearly named project, "Imported observations". Original observation properties are retained. This function is pure and does not delete, overwrite, or persist the legacy data.

The next integration step must use a verified read-back migration: write the new workspace to encrypted storage, read and validate it, compare its observations against the source records, and only then retire the old payload. On any error, preserve the old data and lock editing rather than falling back to plaintext.

## Coordinate reference system design

Coordinates must not be interpreted from numeric X/Y values alone. The application integration will store CRS metadata at project level:

- CRS authority/code (for example EPSG code where applicable)
- Datum / geodetic reference frame
- Projection (for example UTM)
- UTM zone and hemisphere when applicable
- Coordinate units
- Optional vertical datum and elevation units

Existing X_UTM/Y_UTM/Z_UTM fields remain unchanged during migration. Existing records receive an "Unspecified" CRS state until a user explicitly assigns one; no datum or UTM zone is guessed.

## Explicitly excluded

Offline maps, photo capture, track recording, and compass features are out of scope as requested.
