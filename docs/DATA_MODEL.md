# GeoField workspace data model

## Scope

This document describes the implemented versioned workspace model and the current project, observation, sample, coordinate-reference, and GPS behavior. The app remains offline-first.

## Workspace schema v1

A workspace contains four top-level properties:

- `schemaVersion`: integer schema version.
- `projects`: project metadata and coordinate reference settings.
- `observations`: geological observation records, each assigned to one project through `projectId`.
- `samples`: sample register entries assigned to a project, with an optional observation reference.

Projects, observations, and samples have unique stable IDs. Observation and sample project references must resolve. If a sample links to an observation, both must belong to the same project. Sample codes must be unique within their project. Collection limits are enforced before persistence.

## Legacy compatibility and storage

`migrateLegacyRecords()` converts the former flat observation array into a workspace and assigns imported observations to a clearly named project, "Imported observations". Original observation properties are retained.

Workspace writes use the existing encrypted native storage path. Migration verifies the saved workspace by reading it back before retiring a matching legacy plaintext copy. On verification failure, the legacy copy is retained and editing is locked. Browser preview storage is localStorage and is not encrypted; Android native storage uses the Android Keystore-backed implementation.

## Project coordinate reference settings

CRS metadata is stored per project:

- Coordinate system: Unknown, Geographic, UTM, or Local.
- Horizontal datum.
- UTM zone (1–60) and hemisphere (N/S), where applicable.
- Horizontal unit (metre, foot, or degree).
- Optional vertical datum and elevation unit.

Unknown values remain explicitly unknown. The application does not infer a datum, UTM zone, hemisphere, or vertical datum from legacy numeric coordinates. The current project form does not yet perform coordinate transformations or validate EPSG authority codes.

## GPS position capture

GPS capture is an explicit, user-initiated action available in the Coordinate section. Android location permission is checked and requested only after the user taps **Capture GPS Position**; the app does not continuously track location or request background location.

A captured fix is stored on the observation as:

- `GPS_Latitude` and `GPS_Longitude`: decimal degrees in WGS 84 (EPSG:4326).
- `GPS_Accuracy_m`: device-reported horizontal accuracy in metres.
- `GPS_Altitude_m`: device-reported altitude in metres, when supplied by the device.
- `GPS_Timestamp`: ISO 8601 capture time.

GPS latitude/longitude are stored separately from `X_UTM`/`Y_UTM`; the app does not silently transform or copy WGS 84 coordinates into projected coordinate fields. Device GPS accuracy varies with hardware, satellite visibility, terrain, and surroundings. Device altitude is not assigned a vertical datum by the app and should not be treated as a surveyed elevation without independent verification.

## Observation search and sample register

Observation search is scoped to the active project and supports full-field text search, geologist, lithology, and date-range filters. Sample entries can be created, edited, and deleted; sample codes are unique within a project. A sample may be linked only to an observation in the same project.

## Explicitly excluded

Offline maps, photo capture, track recording, and compass features are out of scope as requested.
