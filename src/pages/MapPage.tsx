import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Search,
  Layers,
  Plus,
  Minus,
  RotateCcw,
  Crosshair,
  Compass,
  MapPin,
  AlertTriangle,
  Flag,
  Navigation,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  FileText,
  Car,
  ExternalLink,
  Grid,
  X
} from 'lucide-react';
import { MarsMapView } from '../map/MarsMapView';
import { type MarsMap, type TrekLayerDef, type MarkerDef } from '../map/MarsMap';
import { loadTrekLayers, FALLBACK_TREK_LAYERS } from '../map/layers';
import { trekDeepLink } from '../core/trekLink';
import { GlassPanel } from '../components/ui/GlassPanel';
import { SegmentedControl } from '../components/ui/Tabs';
import { Chip } from '../components/ui/Chip';
import { Button } from '../components/ui/Button';
import { ProvenanceBadge } from '../components/ui/ProvenanceBadge';
import { OriginBadge } from '../components/ui/OriginBadge';
import { LocationReportDrawer } from '../components/location/LocationReportDrawer';
import { useRoutePlanner } from '../hooks/useRoutePlanner';
import { useRouteStore } from '../state/routeStore';
import type { RouteResult } from '../core/route/types';
import { SCIENCE_CATALOG } from '../data/scienceCatalog';
import { HAZARDS_CATALOG } from '../data/hazardsCatalog';
import { ALL_ROVER_TRAVERSES } from '../data/roverTraverses';
import { getLocationReport } from '../core/report';
import { searchLocations, parseCoordinateInput } from '../core/search';
import { calculateTerrainQuality } from '../core/terrain';
import { getElevationM, getSlopeDeg } from '../core/dem';
import { normalizeLon360, lon360ToDisplay } from '../core/geo';
import type { Checkpoint, LocationReport } from '../core/types';
import type { MarsCoordinate, PlannedRoute } from '../types/route';

type MapMode = 'Terrain' | 'Elevation' | 'Hazard';

const GALE_TREK_BYPASS_URL =
  'https://trek.nasa.gov/mars/#v=0.1&x=137.18169410377863&y=-6.543469565266718&z=9&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104905&d=&locale=&b=mars&e=136.30278787017335%2C-6.9808627455843375%2C138.0606003373839%2C-6.106076384949098&sfz=&w=';

export const MapPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mapRef = useRef<MarsMap | null>(null);

  // Map and layer states
  const [trekLayers, setTrekLayers] = useState<TrekLayerDef[]>(FALLBACK_TREK_LAYERS);
  const [activeBaseLayerId, setActiveBaseLayerId] = useState<string>('viking-color');
  const [mode, setMode] = useState<MapMode>('Terrain');
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [isRoverCardDismissed, setIsRoverCardDismissed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 320);
    return () => clearTimeout(timer);
  }, [isLeftPanelOpen]);
  const [isDegraded, setIsDegraded] = useState(false);
  const [showGraticule, setShowGraticule] = useState(true);

  // Data collections
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Layer filter toggles
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>({
    landing: true,
    poi: true,
    rovers: true,
    route: true,
    hazards: true
  });

  const [activeResources, setActiveResources] = useState<string[]>([]);

  // Selection & Coordinates
  const [cursorCoord, setCursorCoord] = useState<{
    latitude: number;
    longitude: number;
    displayLon: number;
    elevationMeters?: number | null;
  } | null>(null);

  const [selectedCoord, setSelectedCoord] = useState<MarsCoordinate | null>({
    latitude: 18.4447,
    longitude: 77.4508
  });
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Checkpoint | null>(null);

  // Drawer
  const [activeReport, setActiveReport] = useState<LocationReport | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);

  // Routing
  const store = useRouteStore();
  const {
    startCoord,
    destCoord,
    setStartCoord,
    setDestCoord,
    primaryRoute
  } = useRoutePlanner();

  const storedPrimaryRoute: PlannedRoute | null = useMemo(() => {
    const successRoute = store.results.find((r): r is RouteResult => (r as any).ok === true);
    if (!successRoute || successRoute.geometry.length === 0) return null;
    const waypoints = successRoute.geometry.map((pt) => ({ latitude: pt.lat, longitude: pt.lonE }));
    return {
      id: 'stored-route',
      name: `${successRoute.mode} Route`,
      start: waypoints[0],
      destination: waypoints[waypoints.length - 1],
      waypoints,
      distanceKm: successRoute.distanceKm,
      estimatedDurationHours: successRoute.timeHours,
      method:
        successRoute.mode === 'A_DIRECT'
          ? 'direct'
          : successRoute.mode === 'C_ROVER_REFERENCE'
          ? 'historical-rover-reference'
          : 'terrain-aware',
      terrainAssessmentAvailable: true,
      maxSlopeDeg: successRoute.maxSlopeDeg ?? undefined,
      averageSlopeDeg: successRoute.meanSlopeDeg ?? undefined,
      cumulativeElevationGainMeters: successRoute.climbM || 0,
      dataLimitations: successRoute.warnings,
      hazardsIntersected: [],
      scienceTargetsNear: []
    };
  }, [store.results]);

  const activePrimaryRoute = storedPrimaryRoute || primaryRoute;

  // Load verified Trek layers
  useEffect(() => {
    loadTrekLayers().then((loaded) => {
      setTrekLayers(loaded);
    });
  }, []);

  // Load checkpoints and handle query params
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/checkpoints.json`)
      .then((r) => r.json())
      .then((data: Checkpoint[]) => {
        setCheckpoints(data);
        const latParam = searchParams.get('lat');
        const lonParam = searchParams.get('lon');
        if (latParam && lonParam) {
          const lat = parseFloat(latParam);
          const lon = parseFloat(lonParam);
          if (!isNaN(lat) && !isNaN(lon)) {
            const coord = { latitude: lat, longitude: lon };
            setSelectedCoord(coord);
            mapRef.current?.flyTo(lat, lon);
            const found = data.find(
              (c) => Math.abs(c.lat - lat) < 0.2 && Math.abs(c.lonE - normalizeLon360(lon)) < 0.2
            );
            if (found) setSelectedCheckpoint(found);
          }
        }
      })
      .catch((err) => console.warn('[MAP] Failed to load checkpoints:', err));
  }, [searchParams]);

  // Handle segmented mode change (Terrain / Elevation / Hazard)
  const handleModeChange = (newMode: MapMode) => {
    setMode(newMode);
    if (newMode === 'Terrain') {
      setActiveBaseLayerId('viking-color');
    } else if (newMode === 'Elevation') {
      const hasMola = trekLayers.some((l) => l.id === 'mola-shaded-relief');
      setActiveBaseLayerId(hasMola ? 'mola-shaded-relief' : 'viking-color');
    } else if (newMode === 'Hazard') {
      setActiveBaseLayerId('viking-color');
      setActiveLayers((prev) => ({ ...prev, hazards: true }));
    }
  };

  // Search autocomplete
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    const res = searchLocations(searchQuery, checkpoints, 6);
    setSearchResults(res);
    setShowSearchResults(true);
  }, [searchQuery, checkpoints]);

  const handleSelectCoordinate = useCallback(
    (coord: MarsCoordinate) => {
      setSelectedCoord(coord);
      const lonE = normalizeLon360(coord.longitude);
      const report = getLocationReport({ lat: coord.latitude, lonE }, checkpoints);
      setActiveReport(report);

      const closest = checkpoints.find((c) => {
        const dLat = Math.abs(c.lat - coord.latitude);
        const dLon = Math.abs(c.lonE - lonE);
        return dLat < 0.25 && dLon < 0.25;
      });
      setSelectedCheckpoint(closest || null);
    },
    [checkpoints]
  );

  const handleMapClick = useCallback(
    (p: { lat: number; lonE: number }) => {
      const coord = { latitude: p.lat, longitude: p.lonE };
      handleSelectCoordinate(coord);
      setIsReportOpen(true);
    },
    [handleSelectCoordinate]
  );

  const handleCursorMove = useCallback(
    (p: { lat: number; lonE: number; displayLon: number }) => {
      const elev = getElevationM(p.lat, p.lonE)?.value ?? null;
      setCursorCoord({
        latitude: p.lat,
        longitude: p.lonE,
        displayLon: p.displayLon,
        elevationMeters: elev
      });
    },
    []
  );

  const handleSetStart = useCallback(
    (coord: MarsCoordinate) => {
      setStartCoord(coord);
    },
    [setStartCoord]
  );

  const handleSetDestination = useCallback(
    (coord: MarsCoordinate) => {
      setDestCoord(coord);
    },
    [setDestCoord]
  );

  const handleZoomIn = () => {
    mapRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapRef.current?.zoomOut();
  };

  const handleResetView = () => {
    mapRef.current?.fitWorld();
    setSelectedCoord(null);
    setSelectedCheckpoint(null);
  };

  const handleLocatePrompt = () => {
    const input = window.prompt(
      'Enter Martian coordinates (e.g. "18.44N, 77.45E" or "-4.59, 137.44"):'
    );
    if (input) {
      const parsed = parseCoordinateInput(input);
      if (parsed) {
        const coord = { latitude: parsed.lat, longitude: parsed.lonE };
        setSelectedCoord(coord);
        mapRef.current?.flyTo(parsed.lat, parsed.lonE, 7);
        handleSelectCoordinate(coord);
      } else {
        alert('Could not parse coordinate format. Please use "Lat, Lon" e.g. 18.44, 77.45');
      }
    }
  };

  // Convert and memoize markers
  const markers: MarkerDef[] = useMemo(() => {
    const list: MarkerDef[] = [];

    for (const c of checkpoints) {
      if (c.kind === 'landing_site' && !activeLayers.landing) continue;
      if (c.kind === 'landmark' && !activeLayers.poi) continue;
      if (c.kind === 'science_site' && !activeLayers.poi) continue;
      if (c.kind === 'hazard' && !activeLayers.hazards) continue;

      // Filter by active scientific resources when chips are selected
      if (activeResources.length > 0) {
        const hasMatchingResource = c.resources?.some((r) => {
          const t = r.type.toLowerCase();
          return activeResources.some((f) => {
            if (f === 'water_ice') return t.includes('ice') || t.includes('water');
            if (f === 'clay') return t.includes('clay') || t.includes('hydrated') || t.includes('smectite') || t.includes('kaolinite');
            if (f === 'sulfate') return t.includes('sulfate') || t.includes('gypsum') || t.includes('jarosite');
            if (f === 'iron_oxide') return t.includes('iron') || t.includes('hematite');
            if (f === 'volcanic') return t.includes('volcanic') || t.includes('basalt') || t.includes('pyroxene') || t.includes('olivine');
            if (f === 'carbonate') return t.includes('carbonate');
            if (f === 'metal') return t.includes('metal') || t.includes('meteorite');
            return t.includes(f);
          });
        });
        if (!hasMatchingResource) continue;
      }

      const isSelected =
        selectedCheckpoint?.id === c.id ||
        (selectedCoord &&
          Math.abs(c.lat - selectedCoord.latitude) < 0.05 &&
          Math.abs(c.lonE - normalizeLon360(selectedCoord.longitude)) < 0.05);

      let color =
        c.kind === 'landing_site'
          ? '#56D9E8'
          : c.kind === 'hazard'
          ? '#EF4444'
          : c.kind === 'science_site'
          ? '#A78BFA'
          : '#FF7043';

      if (activeResources.length > 0 && c.resources?.length) {
        const primaryRes = c.resources[0].type.toLowerCase();
        if (primaryRes.includes('ice') || primaryRes.includes('water')) color = '#56D9E8';
        else if (primaryRes.includes('clay') || primaryRes.includes('hydrated')) color = '#F5B544';
        else if (primaryRes.includes('sulfate')) color = '#B392F0';
        else if (primaryRes.includes('iron')) color = '#FF7043';
        else if (primaryRes.includes('volcanic') || primaryRes.includes('basalt')) color = '#EF4444';
        else if (primaryRes.includes('carbonate')) color = '#4ADE80';
        else if (primaryRes.includes('metal')) color = '#A0A0A0';
      }

      const iconChar =
        c.kind === 'landing_site'
          ? '✦'
          : c.kind === 'hazard'
          ? '▲'
          : c.kind === 'science_site'
          ? '◆'
          : '●';

      const html = `
        <div style="position:relative; width:28px; height:28px; display:flex; align-items:center; justify-content:center;">
          ${
            isSelected
              ? `<div style="position:absolute; inset:-4px; border-radius:50%; border:2px solid ${color}; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; opacity:0.75;"></div>`
              : ''
          }
          <div style="width:20px; height:20px; border-radius:50%; background:#101114; border:2px solid ${color}; color:${color}; font-size:10px; font-weight:bold; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,0.6);">
            ${iconChar}
          </div>
        </div>
      `;

      list.push({
        id: c.id,
        lat: c.lat,
        lonE: c.lonE,
        label: c.name,
        html,
        onClick: () => {
          const coord = { latitude: c.lat, longitude: c.lonE };
          setSelectedCoord(coord);
          setSelectedCheckpoint(c);
          mapRef.current?.flyTo(c.lat, c.lonE);
          const report = getLocationReport({ lat: c.lat, lonE: c.lonE }, checkpoints);
          setActiveReport(report);
          setIsReportOpen(true);
        }
      });
    }

    // Selected location pin
    if (
      selectedCoord &&
      (!selectedCheckpoint ||
        Math.abs(selectedCheckpoint.lat - selectedCoord.latitude) >= 0.05 ||
        Math.abs(selectedCheckpoint.lonE - normalizeLon360(selectedCoord.longitude)) >= 0.05)
    ) {
      list.push({
        id: 'selected-location-pin',
        lat: selectedCoord.latitude,
        lonE: normalizeLon360(selectedCoord.longitude),
        label: 'Selected Coordinate',
        html: `
          <div style="position:relative; width:28px; height:28px; display:flex; align-items:center; justify-content:center;">
            <div style="position:absolute; inset:-4px; border-radius:50%; border:2px solid #56D9E8; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; opacity:0.75;"></div>
            <div style="width:16px; height:16px; border-radius:50%; background:#56D9E8; border:2px solid #FFFFFF; box-shadow:0 0 10px #56D9E8;"></div>
          </div>
        `
      });
    }

    return list;
  }, [checkpoints, activeLayers, selectedCheckpoint, selectedCoord, activeResources]);

  // Convert route into segments (ok / steep / nodata)
  const routeSegments = useMemo(() => {
    const segments: { points: [number, number][]; flag: 'ok' | 'steep' | 'nodata' }[] = [];

    // 1. Primary Planned Route
    if (activeLayers.route && activePrimaryRoute?.waypoints && activePrimaryRoute.waypoints.length >= 2) {
      const pts = activePrimaryRoute.waypoints;
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const slope =
          activePrimaryRoute.elevationProfile?.[i]?.slopeDeg ??
          getSlopeDeg(p1.latitude, normalizeLon360(p1.longitude));

        const flag: 'ok' | 'steep' | 'nodata' =
          slope === null || slope === undefined || isNaN(slope)
            ? 'nodata'
            : slope > 15
            ? 'steep'
            : 'ok';

        segments.push({
          points: [
            [p1.latitude, p1.longitude],
            [p2.latitude, p2.longitude]
          ],
          flag
        });
      }
    }

    // 2. Rover Traverses
    if (activeLayers.rovers) {
      for (const rover of ALL_ROVER_TRAVERSES) {
        if (!rover.waypoints || rover.waypoints.length < 2) continue;
        for (let i = 0; i < rover.waypoints.length - 1; i++) {
          segments.push({
            points: [
              [rover.waypoints[i].latitude, rover.waypoints[i].longitude],
              [rover.waypoints[i + 1].latitude, rover.waypoints[i + 1].longitude]
            ],
            flag: 'ok'
          });
        }
      }
    }

    return segments;
  }, [activeLayers.route, activeLayers.rovers, activePrimaryRoute]);

  // Selected location metrics
  const selectedElev = useMemo(() => {
    if (!selectedCoord) return null;
    const elev = getElevationM(selectedCoord.latitude, normalizeLon360(selectedCoord.longitude));
    return elev ? elev.value : null;
  }, [selectedCoord]);

  const selectedSlope = useMemo(() => {
    if (!selectedCoord) return 0;
    return getSlopeDeg(selectedCoord.latitude, normalizeLon360(selectedCoord.longitude));
  }, [selectedCoord]);

  const terrainAssessment = useMemo(() => {
    return calculateTerrainQuality({
      slopeDeg: selectedSlope,
      roughnessM: 0.2
    });
  }, [selectedSlope]);

  const terrainDifficultyText =
    terrainAssessment.class === 'Favourable'
      ? 'Low'
      : terrainAssessment.class === 'Moderate'
      ? 'Moderate'
      : 'High';

  const cursorElev = useMemo(() => {
    if (!cursorCoord) return null;
    return (
      cursorCoord.elevationMeters ??
      getElevationM(cursorCoord.latitude, normalizeLon360(cursorCoord.longitude))?.value ??
      null
    );
  }, [cursorCoord]);

  const cursorSlope = useMemo(() => {
    if (!cursorCoord) return null;
    return getSlopeDeg(cursorCoord.latitude, normalizeLon360(cursorCoord.longitude));
  }, [cursorCoord]);

  const resourceTypes = [
    { id: 'water_ice', label: 'Water-ice', color: '#56D9E8' },
    { id: 'clay', label: 'Clays', color: '#F5B544' },
    { id: 'sulfate', label: 'Sulfates', color: '#B392F0' },
    { id: 'iron_oxide', label: 'Iron oxides', color: '#FF7043' },
    { id: 'volcanic', label: 'Volcanic', color: '#EF4444' },
    { id: 'carbonate', label: 'Carbonates', color: '#4ADE80' },
    { id: 'metal', label: 'Metal', color: '#A0A0A0' }
  ];

  return (
    <div className="relative w-full h-full flex min-h-0 overflow-hidden bg-[#0B0D10] select-none">
      {/* Left Control & Filter Panel (320px) */}
      <aside
        className={`absolute lg:relative z-20 top-0 bottom-0 left-0 w-80 bg-[#101114]/95 backdrop-blur-xl border-r border-[rgba(231,225,216,0.12)] shadow-2xl flex flex-col justify-between transition-transform duration-300 ease-out ${
          isLeftPanelOpen ? 'translate-x-0' : '-translate-x-full lg:-translate-x-full'
        }`}
      >
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Panel Header */}
          <div className="flex items-center justify-between border-b border-[rgba(231,225,216,0.08)] pb-3">
            <div className="flex items-center gap-2">
              <Compass className="w-5 h-5 text-[#FF7043]" />
              <h1 className="font-display font-bold text-lg uppercase tracking-wider text-[#E7E1D8]">
                MAP
              </h1>
            </div>
            <button
              onClick={() => setIsLeftPanelOpen(false)}
              className="p-1 rounded-lg text-[#A0A0A0] hover:text-[#E7E1D8] lg:hidden cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>

          {/* Segmented Control: Terrain · Elevation · Hazard */}
          <div>
            <span className="text-[11px] font-mono uppercase text-[#A0A0A0] block mb-1.5 font-semibold">
              BASE VIEW
            </span>
            <SegmentedControl
              options={[
                { id: 'Terrain', label: 'Terrain' },
                { id: 'Elevation', label: 'Elevation' },
                { id: 'Hazard', label: 'Hazard' }
              ]}
              value={mode}
              onChange={handleModeChange}
              className="w-full"
            />
          </div>

          {/* Quick Focus Operational Terrains */}
          <div>
            <span className="text-[11px] font-mono uppercase text-[#A0A0A0] block mb-1.5 font-semibold">
              OPERATIONAL TERRAINS
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveBaseLayerId('gale-crater-offline');
                  mapRef.current?.flyTo(-6.5435, 137.1817, 8);
                  const gale = checkpoints.find((c) => c.id.includes('gale') || c.id.includes('curiosity'));
                  if (gale) setSelectedCheckpoint(gale);
                }}
                className="p-2.5 rounded-xl bg-[#15181D] hover:bg-[#1C2027] border border-[rgba(231,225,216,0.12)] hover:border-[#F08A50]/50 text-left transition-all cursor-pointer group"
              >
                <div className="text-[11px] font-display font-bold text-[#E7E1D8] group-hover:text-[#F08A50] truncate">
                  Gale Crater
                </div>
                <div className="text-[9px] font-mono text-[#56D9E8] flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]"></span>
                  <span>Offline Ready</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveBaseLayerId('viking-color');
                  mapRef.current?.flyTo(18.4447, 77.4508, 7);
                  const jezero = checkpoints.find((c) => c.id.includes('jezero'));
                  if (jezero) setSelectedCheckpoint(jezero);
                }}
                className="p-2.5 rounded-xl bg-[#15181D] hover:bg-[#1C2027] border border-[rgba(231,225,216,0.12)] hover:border-[#56D9E8]/50 text-left transition-all cursor-pointer group"
              >
                <div className="text-[11px] font-display font-bold text-[#E7E1D8] group-hover:text-[#56D9E8] truncate">
                  Jezero Crater
                </div>
                <div className="text-[9px] font-mono text-[#56D9E8] flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]"></span>
                  <span>Offline Ready</span>
                </div>
              </button>
            </div>
          </div>

          {/* Search Field */}
          <div className="relative">
            <span className="text-[11px] font-mono uppercase text-[#A0A0A0] block mb-1.5 font-semibold">
              SEARCH LOCATIONS
            </span>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#15181D] border border-[rgba(231,225,216,0.12)] focus-within:border-[#FF7043]/60">
              <Search className="w-4 h-4 text-[#A0A0A0] shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowSearchResults(searchResults.length > 0)}
                placeholder="Search landmarks or coordinates..."
                className="w-full bg-transparent text-xs text-[#E7E1D8] placeholder-[#6B6F76] focus:outline-none"
              />
            </div>

            {/* Autocomplete Dropdown */}
            {showSearchResults && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#15181D] border border-[rgba(231,225,216,0.15)] rounded-xl shadow-2xl p-1.5 z-50 max-h-56 overflow-y-auto">
                {searchResults.map((res, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      const coord = { latitude: res.lat, longitude: res.lonE };
                      setSelectedCoord(coord);
                      mapRef.current?.flyTo(res.lat, res.lonE, 7);
                      handleSelectCoordinate(coord);
                      setShowSearchResults(false);
                      setSearchQuery(res.title);
                    }}
                    className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[#1C2027] text-left text-xs text-[#E7E1D8] cursor-pointer"
                  >
                    <span className="truncate font-medium">{res.title}</span>
                    <span className="text-[10px] font-mono text-[#56D9E8] ml-2 shrink-0">
                      {res.lat.toFixed(1)}°, {res.lonE.toFixed(1)}°E
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Legend / Layer Toggles */}
          <div>
            <span className="text-[11px] font-mono uppercase text-[#A0A0A0] block mb-2 font-semibold">
              MAP LAYERS & LEGEND
            </span>
            <div className="space-y-1.5 text-xs font-sans">
              <label className="flex items-center justify-between p-2 rounded-lg hover:bg-[#15181D] cursor-pointer">
                <div className="flex items-center gap-2">
                  <Flag className="w-3.5 h-3.5 text-[#56D9E8]" />
                  <span>Landing Sites</span>
                </div>
                <input
                  type="checkbox"
                  checked={activeLayers.landing}
                  onChange={(e) => setActiveLayers((p) => ({ ...p, landing: e.target.checked }))}
                  className="accent-[#FF7043]"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg hover:bg-[#15181D] cursor-pointer">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-[#FF7043]" />
                  <span>Points of Interest</span>
                </div>
                <input
                  type="checkbox"
                  checked={activeLayers.poi}
                  onChange={(e) => setActiveLayers((p) => ({ ...p, poi: e.target.checked }))}
                  className="accent-[#FF7043]"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg hover:bg-[#15181D] cursor-pointer">
                <div className="flex items-center gap-2">
                  <Car className="w-3.5 h-3.5 text-[#F5B544]" />
                  <span>Rover Tracks</span>
                </div>
                <input
                  type="checkbox"
                  checked={activeLayers.rovers}
                  onChange={(e) => setActiveLayers((p) => ({ ...p, rovers: e.target.checked }))}
                  className="accent-[#FF7043]"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg hover:bg-[#15181D] cursor-pointer">
                <div className="flex items-center gap-2">
                  <Navigation className="w-3.5 h-3.5 text-[#4ADE80]" />
                  <span>Safe Route</span>
                </div>
                <input
                  type="checkbox"
                  checked={activeLayers.route}
                  onChange={(e) => setActiveLayers((p) => ({ ...p, route: e.target.checked }))}
                  className="accent-[#FF7043]"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg hover:bg-[#15181D] cursor-pointer">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444]" />
                  <span>Hazard Zone</span>
                </div>
                <input
                  type="checkbox"
                  checked={activeLayers.hazards}
                  onChange={(e) => setActiveLayers((p) => ({ ...p, hazards: e.target.checked }))}
                  className="accent-[#FF7043]"
                />
              </label>
            </div>
          </div>

          {/* Resource Chips */}
          <div>
            <span className="text-[11px] font-mono uppercase text-[#A0A0A0] block mb-2 font-semibold">
              SCIENTIFIC RESOURCES
            </span>
            <div className="flex flex-wrap gap-1.5">
              {resourceTypes.map((res) => {
                const isSelected = activeResources.includes(res.id);
                return (
                  <Chip
                    key={res.id}
                    label={res.label}
                    color={res.color}
                    selected={isSelected}
                    onToggle={() =>
                      setActiveResources((prev) =>
                        isSelected ? prev.filter((x) => x !== res.id) : [...prev, res.id]
                      )
                    }
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Selected Location Card (Bottom of Left Panel) */}
        <div className="p-4 border-t border-[rgba(231,225,216,0.12)] bg-[#15181D]/90">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono tracking-widest uppercase text-[#FF7043] font-bold">
              SELECTED LOCATION
            </span>
            <ProvenanceBadge type="NASA-DERIVED" />
          </div>

          <div className="flex items-start gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#56D9E8]/15 text-[#56D9E8] flex items-center justify-center shrink-0 mt-0.5">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-bold text-sm text-[#E7E1D8] truncate">
                {selectedCheckpoint?.name || 'Martian Coordinate'}
              </h2>
              <p className="text-[11px] text-[#A0A0A0] truncate">
                {selectedCheckpoint?.summary ||
                  `${selectedCoord?.latitude.toFixed(2)}°N, ${selectedCoord ? normalizeLon360(selectedCoord.longitude).toFixed(2) : ''}°E`}
              </p>
            </div>
          </div>

          <div className="space-y-1.5 py-2 border-y border-[rgba(231,225,216,0.08)] mb-3 text-xs font-mono">
            <div className="flex justify-between items-center">
              <span className="text-[#A0A0A0]">Elevation</span>
              <span className="font-bold text-[#E7E1D8]">
                {selectedElev !== null ? `${selectedElev > 0 ? '+' : ''}${selectedElev.toLocaleString()} m` : 'Calculating...'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#A0A0A0]">Terrain Difficulty</span>
              <span
                className={`font-semibold ${
                  terrainDifficultyText === 'Low'
                    ? 'text-[#4ADE80]'
                    : terrainDifficultyText === 'Moderate'
                    ? 'text-[#F5B544]'
                    : 'text-[#EF4444]'
                }`}
              >
                {terrainDifficultyText}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (selectedCoord) {
                  handleSetDestination(selectedCoord);
                  navigate('/planner/route');
                }
              }}
              className="flex-1 text-xs"
            >
              Set as Destination
            </Button>
            <button
              type="button"
              onClick={() => {
                if (selectedCoord) {
                  const lonE = normalizeLon360(selectedCoord.longitude);
                  const report = getLocationReport({ lat: selectedCoord.latitude, lonE }, checkpoints);
                  setActiveReport(report);
                  setIsReportOpen(true);
                }
              }}
              className="px-3 py-2 rounded-lg text-xs font-display font-semibold text-[#56D9E8] hover:bg-[#1C2027] border border-[#56D9E8]/30 transition-all cursor-pointer"
            >
              Full report
            </button>
          </div>
        </div>
      </aside>

      {/* Floating Panel Toggle (Desktop & Mobile) */}
      {!isLeftPanelOpen && (
        <button
          type="button"
          onClick={() => setIsLeftPanelOpen(true)}
          className="absolute top-4 left-4 z-30 p-2.5 rounded-xl bg-[#101114]/90 backdrop-blur-md border border-[rgba(231,225,216,0.15)] text-[#E7E1D8] hover:text-[#FF7043] shadow-xl cursor-pointer"
          title="Open Map Controls & Legend"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {/* Centre: Bounded Mars Map Canvas */}
      <main className="flex-1 min-h-0 relative w-full h-full overflow-hidden">
        {/* Degraded Basemap Warning Banner (§4.4, §6) with Offline & Trek Bypass Actions */}
        {isDegraded && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2.5 rounded-xl bg-[#101114]/95 border border-[#F38BA8] text-[#E7E1D8] text-xs font-mono shadow-2xl flex flex-wrap items-center gap-3 backdrop-blur-md max-w-[95vw]">
            <div className="flex items-center gap-2 text-[#F38BA8]">
              <AlertTriangle className="w-4 h-4 shrink-0 text-[#F38BA8]" />
              <span className="font-semibold">Cached basemap active — detailed tiles unavailable</span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => {
                  setActiveBaseLayerId('gale-crater-offline');
                  mapRef.current?.flyTo(-6.5435, 137.1817, 8);
                }}
                className="px-2.5 py-1 rounded bg-[#56D9E8]/20 hover:bg-[#56D9E8]/30 border border-[#56D9E8]/50 text-[#56D9E8] font-medium transition-colors cursor-pointer"
                title="Switch to local offline detailed tiles for Gale Crater"
              >
                Focus Gale Offline Basemap
              </button>
              <a
                href={GALE_TREK_BYPASS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded bg-[#F08A50]/20 hover:bg-[#F08A50]/30 border border-[#F08A50]/60 text-[#F08A50] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Bypass internal map and view fixed NASA Mars Trek portal"
              >
                <span>Bypass to Mars Trek</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                type="button"
                onClick={() => {
                  mapRef.current?.retryTiles();
                  setIsDegraded(false);
                }}
                className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-[#E7E1D8] transition-colors cursor-pointer"
                title="Clear errors and retry loading live NASA tiles"
              >
                Retry Live Tiles
              </button>
              <ProvenanceBadge type="NASA-DERIVED" />
            </div>
          </div>
        )}

        <MarsMapView
          layers={trekLayers}
          baseLayerId={activeBaseLayerId}
          markers={markers}
          initial={{ lat: 0, lonE: 0, zoom: 1 }}
          onMapClick={handleMapClick}
          onCursorMove={handleCursorMove}
          onBackendDegraded={setIsDegraded}
          routeSegments={routeSegments}
          showGraticule={showGraticule}
          mapInstanceRef={mapRef}
        />

        {/* Right Map Controls (Vertical Stack of Glass Icon Buttons) */}
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
          <button
            type="button"
            onClick={() =>
              handleModeChange(
                mode === 'Terrain' ? 'Elevation' : mode === 'Elevation' ? 'Hazard' : 'Terrain'
              )
            }
            className="p-3 rounded-xl bg-[#101114]/85 backdrop-blur-md border border-[rgba(231,225,216,0.12)] text-[#E7E1D8] hover:text-[#FF7043] hover:bg-[#1C2027] shadow-xl transition-all cursor-pointer"
            title={`Toggle Basemap Mode (Current: ${mode})`}
          >
            <Layers className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setShowGraticule((prev) => !prev)}
            className={`p-3 rounded-xl bg-[#101114]/85 backdrop-blur-md border border-[rgba(231,225,216,0.12)] hover:bg-[#1C2027] shadow-xl transition-all cursor-pointer ${
              showGraticule ? 'text-[#56D9E8]' : 'text-[#A0A0A0]'
            }`}
            title="Toggle 30° Graticule Grid"
          >
            <Grid className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-3 rounded-xl bg-[#101114]/85 backdrop-blur-md border border-[rgba(231,225,216,0.12)] text-[#E7E1D8] hover:text-white hover:bg-[#1C2027] shadow-xl transition-all cursor-pointer"
            title="Zoom In"
          >
            <Plus className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-3 rounded-xl bg-[#101114]/85 backdrop-blur-md border border-[rgba(231,225,216,0.12)] text-[#E7E1D8] hover:text-white hover:bg-[#1C2027] shadow-xl transition-all cursor-pointer"
            title="Zoom Out"
          >
            <Minus className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            className="p-3 rounded-xl bg-[#101114]/85 backdrop-blur-md border border-[rgba(231,225,216,0.12)] text-[#E7E1D8] hover:text-[#FF7043] hover:bg-[#1C2027] shadow-xl transition-all cursor-pointer"
            title="Recentre to Jezero Crater"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleLocatePrompt}
            className="p-3 rounded-xl bg-[#101114]/85 backdrop-blur-md border border-[rgba(231,225,216,0.12)] text-[#E7E1D8] hover:text-[#56D9E8] hover:bg-[#1C2027] shadow-xl transition-all cursor-pointer"
            title="Locate by Coordinates"
          >
            <Crosshair className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              const lat = selectedCoord ? selectedCoord.latitude : 18.4447;
              const lonE = selectedCoord ? normalizeLon360(selectedCoord.longitude) : 77.4508;
              const z = Math.round(mapRef.current?.getZoom() ?? 9);
              window.open(trekDeepLink(lat, lonE, z), '_blank', 'noopener,noreferrer');
            }}
            className="p-3 rounded-xl bg-[#101114]/85 backdrop-blur-md border border-[rgba(231,225,216,0.12)] text-[#E7E1D8] hover:text-[#56D9E8] hover:bg-[#1C2027] shadow-xl transition-all cursor-pointer"
            title="Open current view in NASA Mars Trek"
            aria-label="Open current view in NASA Mars Trek"
          >
            <ExternalLink className="w-5 h-5" />
          </button>
          <a
            href={GALE_TREK_BYPASS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 rounded-xl bg-[#101114]/85 backdrop-blur-md border border-[#F08A50]/50 text-[#F08A50] hover:bg-[#F08A50]/20 shadow-xl transition-all cursor-pointer flex items-center justify-center"
            title="Bypass map to fixed NASA Mars Trek Gale Crater view"
            aria-label="Bypass map to fixed NASA Mars Trek Gale Crater view"
          >
            <span className="text-[10px] font-mono font-bold uppercase">TREK</span>
          </a>
        </div>

        {/* Bottom-Right Mini Card: Rover Tracks (Dismissible to ensure full marker visibility) */}
        {!isRoverCardDismissed && (
          <div className="absolute bottom-6 right-4 z-20 hidden sm:block">
            <div
              className={`relative flex items-center gap-3 p-3 rounded-2xl bg-[#101114]/90 backdrop-blur-xl border transition-all shadow-2xl ${
                activeLayers.rovers
                  ? 'border-[#FF7043]/40 ring-1 ring-[#FF7043]/20'
                  : 'border-[rgba(231,225,216,0.12)] opacity-70'
              }`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsRoverCardDismissed(true);
                }}
                className="absolute -top-2 -right-2 p-1 rounded-full bg-[#1C2027] border border-[rgba(231,225,216,0.15)] text-[#A0A0A0] hover:text-[#E7E1D8] transition-colors cursor-pointer"
                title="Dismiss overlay"
              >
                <X className="w-3 h-3" />
              </button>
              <div
                onClick={() => setActiveLayers((p) => ({ ...p, rovers: !p.rovers }))}
                className="flex items-center gap-3 cursor-pointer"
              >
                <div className="w-12 h-10 rounded-lg overflow-hidden bg-[#1C2027] shrink-0 border border-[rgba(231,225,216,0.10)] flex items-center justify-center">
                  <img
                    src={`${import.meta.env.BASE_URL}brand/icon-64.png`}
                    alt="Rover"
                    className="w-8 h-8 object-contain"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-display font-bold text-[#E7E1D8]">
                      Rover Tracks
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]" />
                  </div>
                  <p className="text-[11px] font-mono text-[#A0A0A0]">
                    Curiosity & Perseverance ({activeLayers.rovers ? 'Visible' : 'Hidden'})
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Map HUD: Bottom-Left Cursor Readout & OriginBadge */}
        <div className="absolute bottom-6 left-4 z-20 flex items-center gap-3 bg-[#101114]/85 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-[rgba(231,225,216,0.12)] text-xs font-mono text-[#E7E1D8] shadow-xl">
          <div className="flex items-center gap-2">
            <span className="text-[#A0A0A0]">CURSOR:</span>
            <span>
              {cursorCoord
                ? `${cursorCoord.latitude.toFixed(2)}°N, ${normalizeLon360(cursorCoord.longitude).toFixed(2)}°E (${(cursorCoord.displayLon).toFixed(2)}° disp)`
                : 'Over surface'}
            </span>
          </div>
          <span className="text-[#6B6F76]">•</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#A0A0A0]">ELEV:</span>
            <span>
              {cursorElev !== null && cursorElev !== undefined
                ? `${cursorElev > 0 ? '+' : ''}${cursorElev.toFixed(0)} m`
                : '—'}
            </span>
            <ProvenanceBadge type="NASA-DERIVED" />
          </div>
          <span className="text-[#6B6F76]">•</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#A0A0A0]">SLOPE:</span>
            <span>
              {cursorSlope !== null && cursorSlope !== undefined
                ? `${cursorSlope.toFixed(1)}°`
                : '—'}
            </span>
          </div>
          <span className="text-[#6B6F76]">•</span>
          <OriginBadge origin={isDegraded ? 'CACHED' : 'LIVE'} />
        </div>

        {/* Bottom Route Bar (When Route Exists) */}
        {activePrimaryRoute && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-6 py-2.5 rounded-2xl bg-[#101114]/90 backdrop-blur-xl border border-[#56D9E8]/40 shadow-2xl flex items-center gap-6 text-xs font-mono">
            <div>
              <span className="text-[#A0A0A0] text-[10px] uppercase block">TRAVERSE</span>
              <span className="font-bold text-[#56D9E8]">{activePrimaryRoute.distanceKm.toFixed(1)} km</span>
            </div>
            <div>
              <span className="text-[#A0A0A0] text-[10px] uppercase block">TIME</span>
              <span className="font-bold text-[#E7E1D8]">
                {((activePrimaryRoute.estimatedDurationHours || 78.4) / 24.66).toFixed(1)} sols
              </span>
            </div>
            <div>
              <span className="text-[#A0A0A0] text-[10px] uppercase block">SLOPE RISK</span>
              <span className="font-bold text-[#4ADE80]">
                {(activePrimaryRoute.maxSlopeDeg || 14) < 15 ? 'Safe' : 'Caution'}
              </span>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate('/planner/briefing')}
              className="text-xs"
            >
              Mission Briefing
            </Button>
          </div>
        )}
      </main>

      {/* Location Report Drawer (Spec §8) */}
      <LocationReportDrawer
        report={activeReport}
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        onSetStart={handleSetStart}
        onSetDestination={handleSetDestination}
        onRadiusChange={(radiusKm) => {
          if (selectedCoord) {
            const lonE = normalizeLon360(selectedCoord.longitude);
            const updated = getLocationReport(
              { lat: selectedCoord.latitude, lonE },
              checkpoints,
              { radiusKm }
            );
            setActiveReport(updated);
          }
        }}
      />
    </div>
  );
};
