import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// FIX: Declare L for LeafletJS to resolve "Cannot find name 'L'" errors.
declare var L: any;

// --- DYNAMIC API HELPERS ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const fetchAIWeatherData = async (lat, lon) => {
    const prompt = `Provide the current, real-world weather conditions for latitude ${lat} and longitude ${lon}. Your response must be a JSON object, do not include markdown formatting.`;
    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            temp: { type: Type.NUMBER, description: "Temperature in Celsius." },
            humidity: { type: Type.NUMBER, description: "Humidity percentage." },
            condition: { type: Type.STRING, description: "A brief weather description, e.g., 'Partly Cloudy'." },
            icon: { type: Type.STRING, description: "A single emoji representing the weather." },
            windSpeed: { type: Type.NUMBER, description: "Wind speed in km/h." },
            windDirection: { type: Type.STRING, description: "Wind direction, e.g., 'NW'." },
            name: { type: Type.STRING, description: "The name of the location or 'Current Location'." }
        },
        required: ["temp", "humidity", "condition", "icon", "windSpeed", "windDirection", "name"]
    };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        return JSON.parse(response.text);
    } catch (e) {
        console.error("AI Weather Generation Error:", e);
        throw new Error("Failed to generate weather data.");
    }
};

const fetchAIResources = async (lat, lon, alerts) => {
    const alertContext = alerts.length > 0 ? `The area is currently under these alerts: ${alerts.map(a => a.type).join(', ')}.` : 'There are no active disaster alerts.';
    const prompt = `Act as a disaster response coordinator. Based on the location at latitude ${lat}, longitude ${lon}, identify critical emergency resources within a 100km radius. ${alertContext} Prioritize resources relevant to the current alerts. Provide a list of Hospitals, Shelters, and Food Banks. Your response must be a JSON array of objects, do not include markdown formatting. Each object needs a unique id.`;
    const responseSchema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                id: { type: Type.STRING, description: "A unique identifier for the resource." },
                type: { type: Type.STRING, enum: ["Hospital", "Shelter", "Food Bank"] },
                name: { type: Type.STRING, description: "The name of the resource." },
                lat: { type: Type.NUMBER, description: "Latitude of the resource." },
                lng: { type: Type.NUMBER, description: "Longitude of the resource." }
            },
            required: ["id", "type", "name", "lat", "lng"]
        }
    };
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        return JSON.parse(response.text);
    } catch (e) {
        console.error("AI Resource Generation Error:", e);
        // Return an empty array on failure to prevent app crash
        return [];
    }
};


const fetchRealtimeAlerts = async (lat, lon) => {
    const prompt = `Analyze the area within a 100km radius of latitude ${lat} and longitude ${lon}. Based on geographical and typical climate patterns for this location, generate a realistic list of potential and active natural disaster alerts. Your response must be a JSON object, do not include markdown formatting.`;
    
    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            locationName: { type: Type.STRING, description: "The general name of the location, e.g., 'Coastal Tamil Nadu, India'." },
            live_alerts: {
                type: Type.ARRAY,
                description: "Active, ongoing disaster alerts. Generate 2-4 plausible alerts.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING },
                        type: { type: Type.STRING, description: "e.g., 'Severe Thunderstorm Warning', 'Urban Flooding Advisory'" },
                        location: { type: Type.STRING, description: "A more specific location name for the alert." },
                        lat: { type: Type.NUMBER },
                        lng: { type: Type.NUMBER },
                        severity: { type: Type.STRING, enum: ["Low", "Medium", "High", "Critical"] }
                    },
                    required: ["id", "type", "location", "lat", "lng", "severity"]
                }
            },
            predicted_alerts: {
                type: Type.ARRAY,
                description: "Predicted alerts for the near future. Generate 1-2 plausible alerts.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING },
                        type: { type: Type.STRING, description: "e.g., 'Potential Cyclone Formation'" },
                        location: { type: Type.STRING, description: "A broader area for the predicted alert." },
                        lat: { type: Type.NUMBER },
                        lng: { type: Type.NUMBER },
                        severity: { type: Type.STRING, enum: ["Low", "Medium", "High"] },
                        timeframe: { type: Type.STRING, description: "e.g., 'In 24-48 hours'" }
                    },
                     required: ["id", "type", "location", "lat", "lng", "severity", "timeframe"]
                }
            }
        },
        required: ["locationName", "live_alerts", "predicted_alerts"]
    };
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        const data = JSON.parse(response.text);
        // Add unique IDs if the model doesn't provide them reliably
        data.live_alerts.forEach(a => a.id = a.id || `live-${Math.random()}`);
        data.predicted_alerts.forEach(a => a.id = a.id || `pred-${Math.random()}`);
        return data;
    } catch (e) {
        console.error("AI Alert Generation Error:", e);
        throw new Error("Failed to generate disaster alerts.");
    }
};

const fetchAIEvacuationRoute = async (userCoords, alert) => {
    const prompt = `Act as an emergency response routing system. Given a user at latitude ${userCoords.lat}, longitude ${userCoords.lng} and a "${alert.type}" disaster centered at latitude ${alert.lat}, longitude ${alert.lng}, calculate a safe evacuation route. The route should lead the user away from the disaster area towards safety. The response must be a JSON object containing a "route" key, which is an array of coordinate pairs (latitude and longitude). Do not include markdown formatting. For example: {"route": [{"lat": 13.08, "lng": 80.27}, {"lat": 13.09, "lng": 80.28}]}`;
    
    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            route: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        lat: { type: Type.NUMBER },
                        lng: { type: Type.NUMBER }
                    },
                    required: ["lat", "lng"]
                }
            }
        },
        required: ["route"]
    };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        const data = JSON.parse(response.text);
        return data.route;
    } catch (e) {
        console.error("AI Evacuation Route Generation Error:", e);
        throw new Error("Failed to generate evacuation route.");
    }
};

const verifyAIIncidentReport = async (report, coords, activeAlerts) => {
    const alertContext = activeAlerts.length > 0
        ? `For context, these alerts are active in the area: ${activeAlerts.map(a => a.type).join(', ')}.`
        : 'There are no active disaster alerts.';
    
    const prompt = `Act as an incident verification system for a disaster response app. A user at latitude ${coords.lat}, longitude ${coords.lng} has reported a "${report.type}" with the description: "${report.description}".
    
    ${alertContext}
    
    Based on this information, assess if this report is plausible. For example, a "Flooding" report is plausible during a "Severe Thunderstorm Warning". A "Fallen Tree" is plausible after high winds. A "Power Outage" could be related to many alerts. If the description suggests a different incident type, correct it.
    
    Your response must be a JSON object with the following schema, and no markdown formatting:
    {
      "is_verified": boolean, // true if the report is plausible, false otherwise
      "reason": string, // a brief justification for your decision. If not verified, explain why. If verified, explain what makes it plausible.
      "corrected_type": string // The original report type, or a more accurate one based on the description.
    }
    `;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            is_verified: { type: Type.BOOLEAN },
            reason: { type: Type.STRING },
            corrected_type: { type: Type.STRING }
        },
        required: ["is_verified", "reason", "corrected_type"]
    };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        return JSON.parse(response.text);
    } catch (e) {
        console.error("AI Incident Verification Error:", e);
        return { is_verified: false, reason: "Could not verify the report due to a technical error.", corrected_type: report.type };
    }
};

// --- ICONS (as React Components) ---
const icons = {
    menu: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
    ),
    close: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    ),
    map: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>
    ),
    alert: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
    ),
    shield: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
    ),
    refresh: (props) => (
         <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
    ),
    checkShield: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="48px" viewBox="0 0 24 24" width="48px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
    ),
    bell: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/></svg>
    ),
    bellOff: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zM16 11c0-2.48-1.51-4.5-4-4.5S8 8.52 8 11v6h8v-6zm-3.32-8.5-.71-.71-6.36 6.36.71.71 6.36-6.36zm1.42 0 .71-.71 2.12 2.12-.71.71-2.12-2.12z"/></svg>
    ),
    add: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
    ),
    person: (props) => (
         <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
    ),
    thumbUp: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1.91l-.01-.01L23 10z"/></svg>
    ),
    thumbDown: (props) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v1.91l.01.01L1 14c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>
    ),
};

// --- STYLES ---
const GlobalStyles = () => {
    const css = `
        .leaflet-container { height: 100%; width: 100%; }
        .map-icon {
            border-radius: 50%;
            box-shadow: var(--shadow-1);
            border: 2px solid white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .spinner {
            border: 4px solid rgba(0, 0, 0, 0.1);
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border-left-color: var(--google-blue);
            animation: spin 1s ease infinite;
            margin: 20px auto;
        }
        .spinner-small {
            border: 2px solid rgba(0, 0, 0, 0.1);
            width: 16px;
            height: 16px;
            border-radius: 50%;
            border-left-color: var(--google-blue);
            animation: spin 1s ease infinite;
            display: inline-block;
            vertical-align: middle;
        }
        .loading-overlay {
             position: absolute;
             top: 0; left: 0; right: 0; bottom: 0;
             background-color: rgba(255, 255, 255, 0.8);
             display: flex;
             flex-direction: column;
             align-items: center;
             justify-content: center;
             z-index: 2000;
             font-size: 18px;
             color: var(--on-surface-color);
             text-align: center;
             padding: 20px;
        }
        @keyframes pulse {
            0% {
                transform: scale(0.95);
                box-shadow: 0 0 0 0 rgba(66, 133, 244, 0.7);
            }
            70% {
                transform: scale(1);
                box-shadow: 0 0 0 10px rgba(66, 133, 244, 0);
            }
            100% {
                transform: scale(0.95);
                box-shadow: 0 0 0 0 rgba(66, 133, 244, 0);
            }
        }
        @keyframes pulse-yellow {
            0% { box-shadow: 0 0 0 0 rgba(244, 180, 0, 0.7); }
            70% { box-shadow: 0 0 0 10px rgba(244, 180, 0, 0); }
            100% { box-shadow: 0 0 0 0 rgba(244, 180, 0, 0); }
        }
        .user-location-marker {
            width: 18px;
            height: 18px;
            background-color: var(--google-blue);
            border-radius: 50%;
            border: 2px solid white;
            box-shadow: 0 0 5px rgba(0,0,0,0.5);
            animation: pulse 2s infinite;
        }
        .new-report-marker {
            animation: pulse-yellow 1.5s 2;
        }
        .fab {
            position: absolute;
            bottom: 24px;
            right: 24px;
            width: 56px;
            height: 56px;
            background-color: var(--google-blue);
            color: white;
            border-radius: 50%;
            border: none;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: var(--shadow-2);
            cursor: pointer;
            z-index: 1000;
            transition: background-color 0.3s;
        }
        .fab:hover {
            background-color: #3367D6;
        }
        @keyframes highlight {
            from { background-color: rgba(66, 133, 244, 0.2); }
            to { background-color: transparent; }
        }
        .highlight-new {
            animation: highlight 2s ease-out;
        }
    `;
    return <style>{css}</style>;
};

// --- COMPONENTS ---

const Header = ({ onMenuClick, onRefresh, isRefreshing, onToggleAudibleAlerts, isAudibleAlertsEnabled, isOnline }) => {
    const styles = {
        header: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            height: '64px',
            backgroundColor: 'var(--surface-color)',
            boxShadow: 'var(--shadow-1)',
            zIndex: 1000,
            flexShrink: 0,
        },
        leftSection: {
            display: 'flex',
            alignItems: 'center',
        },
        menuButton: {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
            marginRight: '16px',
            color: 'var(--on-surface-variant-color)',
        },
        logo: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '22px',
            fontWeight: 500,
        },
        logoG: { color: 'var(--google-blue)' },
        logoO1: { color: 'var(--google-red)' },
        logoO2: { color: 'var(--google-yellow)' },
        logoG2: { color: 'var(--google-blue)' },
        logoL: { color: 'var(--google-green)' },
        logoE: { color: 'var(--google-red)' },
        appName: {
            marginLeft: '8px',
            color: 'var(--on-surface-variant-color)',
            fontWeight: 400,
        },
        rightSection: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
        },
        iconButton: {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
            color: 'var(--on-surface-variant-color)',
        },
        refreshButton: {
            animation: isRefreshing ? 'spin 1.5s linear infinite' : 'none',
        },
        offlineIndicator: {
            backgroundColor: 'var(--on-surface-variant-color)',
            color: 'white',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 500
        }
    };

    return (
        <header style={styles.header}>
            <div style={styles.leftSection}>
                <button onClick={onMenuClick} style={styles.menuButton} aria-label="Toggle sidebar">
                    <icons.menu />
                </button>
                <div style={styles.logo}>
                    <span style={styles.logoG}>S</span>
                    <span style={styles.logoO1}>a</span>
                    <span style={styles.logoO2}>c</span>
                    <span style={styles.logoG2}>h</span>
                    <span style={styles.logoL}>e</span>
                    <span style={styles.logoE}>t</span>
                    <span style={styles.appName}>Disaster Response</span>
                </div>
            </div>
            <div style={styles.rightSection}>
                 {!isOnline && <span style={styles.offlineIndicator}>Offline</span>}
                 <button onClick={onToggleAudibleAlerts} style={{...styles.iconButton, color: isAudibleAlertsEnabled ? 'var(--google-blue)' : 'var(--on-surface-variant-color)'}} aria-label="Toggle audible alerts">
                    {isAudibleAlertsEnabled ? <icons.bell /> : <icons.bellOff />}
                </button>
                <button onClick={onRefresh} style={{...styles.iconButton, ...styles.refreshButton}} aria-label="Refresh data" disabled={isRefreshing || !isOnline}>
                    <icons.refresh />
                </button>
            </div>
        </header>
    );
};

const Sidebar = ({ isOpen, activeView, onNavigate }) => {
    const styles = {
        sidebar: {
            position: 'absolute',
            top: '64px',
            left: 0,
            bottom: 0,
            width: '280px',
            backgroundColor: 'var(--surface-color)',
            boxShadow: 'var(--shadow-1)',
            transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.3s ease-in-out',
            zIndex: 900,
            display: 'flex',
            flexDirection: 'column',
        } as React.CSSProperties,
        nav: { listStyle: 'none', padding: 0, margin: '8px 0' },
        navItem: {
            display: 'flex',
            alignItems: 'center',
            padding: '12px 24px',
            margin: '4px 12px',
            cursor: 'pointer',
            color: 'var(--on-surface-variant-color)',
            gap: '24px',
            borderRadius: '100px',
            transition: 'background-color 0.2s, color 0.2s',
        },
        navItemActive: {
            backgroundColor: 'rgba(66, 133, 244, 0.1)',
            color: 'var(--google-blue)',
            fontWeight: '500',
        },
    };

    const NavLink = ({ view, icon, label }) => (
        <li onClick={() => onNavigate(view)}>
            <div style={{...styles.navItem, ...(activeView === view && styles.navItemActive)}}>
                {icon}
                <span>{label}</span>
            </div>
        </li>
    );

    return (
        <div style={styles.sidebar}>
            <nav>
                <ul style={styles.nav}>
                    <NavLink view="Dashboard" icon={<icons.map />} label="Dashboard" />
                    <NavLink view="Alerts" icon={<icons.alert />} label="Alerts" />
                    <NavLink view="PlanGenerator" icon={<icons.shield />} label="Plan Generator" />
                </ul>
            </nav>
        </div>
    );
};

const AlertsPanel = ({
    alerts,
    predictedAlerts,
    resources,
    userReports,
    isLoading,
    error,
    onAlertClick,
    onGeneratePlanClick,
    isRouteLoading,
    selectedAlert,
    newReportId,
    onVote,
    userVotes,
}) => {
    const [searchQuery, setSearchQuery] = useState('');

    const severityColors = {
        'Low': 'var(--google-green)',
        'Medium': 'var(--google-yellow)',
        'High': 'var(--google-red)',
        'Critical': 'darkred',
        'Community': 'var(--google-yellow)',
    };
    const styles = {
        panel: {
            width: '320px',
            backgroundColor: 'var(--surface-color)',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-1)',
            zIndex: 800,
            transition: 'transform 0.3s ease-in-out',
        } as React.CSSProperties,
        header: {
            padding: '16px',
            fontSize: '18px',
            fontWeight: '500',
            borderBottom: '1px solid var(--border-color)',
            flexShrink: 0,
        },
        list: {
            overflowY: 'auto',
            padding: '8px',
            flexGrow: 1,
        } as React.CSSProperties,
        card: {
            padding: '12px',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            marginBottom: '8px',
            cursor: 'pointer',
            transition: 'background-color 0.2s, border-left 0.2s',
            borderLeft: '5px solid transparent',
        },
        cardTitle: { fontWeight: 500, marginBottom: '4px' },
        cardLocation: { fontSize: '14px', color: 'var(--on-surface-variant-color)' },
        cardTimeframe: { fontSize: '12px', color: 'var(--on-surface-color)', fontStyle: 'italic', marginTop: '4px' },
        cardDescription: { fontSize: '14px', color: 'var(--on-surface-color)', marginTop: '4px', whiteSpace: 'pre-wrap' as 'pre-wrap' },
        footer: {
            padding: '16px',
            borderTop: '1px solid var(--border-color)',
        },
        button: {
            width: '100%',
            padding: '12px',
            border: 'none',
            borderRadius: '8px',
            backgroundColor: 'var(--google-blue)',
            color: 'white',
            fontSize: '16px',
            cursor: 'pointer',
            fontWeight: 500,
        },
        subHeader: {
            padding: '16px 8px 8px 8px',
            fontSize: '16px',
            fontWeight: '500',
            color: 'var(--on-surface-color)',
        },
        searchInput: {
            width: 'calc(100% - 16px)',
            boxSizing: 'border-box',
            padding: '10px',
            margin: '0 8px 8px 8px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            fontSize: '14px',
        } as React.CSSProperties,
         noResults: {
            padding: '16px',
            textAlign: 'center',
            color: 'var(--on-surface-variant-color)',
        } as React.CSSProperties,
        centeredStatus: {
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            textAlign: 'center',
            color: 'var(--on-surface-variant-color)',
        } as React.CSSProperties,
        errorText: { color: 'var(--google-red)' },
        voteSection: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginTop: '12px',
            paddingTop: '8px',
            borderTop: '1px solid var(--border-color)',
        },
        voteButton: {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: 'var(--on-surface-variant-color)',
            fontSize: '14px',
        },
        voteButtonActive: {
            color: 'var(--google-blue)',
            fontWeight: 'bold',
        }
    };

    const getCardStyle = (severity) => ({
        ...styles.card,
        borderLeftColor: severityColors[severity] || 'transparent',
    });

    const AlertCard = ({ alert }) => {
        const isSelected = selectedAlert && selectedAlert.id === alert.id;
        return (
            <div style={getCardStyle(alert.severity)} onClick={() => onAlertClick(alert)}
                 onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--background-color)'}
                 onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                <div style={styles.cardTitle}>{alert.type}</div>
                <div style={styles.cardLocation}>{alert.location}</div>
                {alert.timeframe && <div style={styles.cardTimeframe}>{alert.timeframe}</div>}
                {isSelected && isRouteLoading && (
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '12px', color: 'var(--on-surface-variant-color)'}}>
                        <div className="spinner-small"></div>
                        <span>Generating safe route...</span>
                    </div>
                )}
            </div>
        );
    };
    
    const ResourceCard = ({ resource }) => (
         <div style={styles.card} onClick={() => onAlertClick(resource)}
             onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--background-color)'}
             onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
            <div style={styles.cardTitle}>{resource.name}</div>
            <div style={styles.cardLocation}>{resource.type}</div>
        </div>
    );
    
    const UserReportCard = ({ report, userVote, onVoteClick }) => (
        <div style={getCardStyle('Community')} className={report.id === newReportId ? 'highlight-new' : ''}>
           <div onClick={() => onAlertClick(report)}>
                <div style={{ ...styles.cardTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <span>{report.type}</span>
                   {report.isVerified && <span style={{fontSize: '10px', fontWeight: 'bold', color: 'var(--google-green)', backgroundColor: 'rgba(15, 157, 88, 0.1)', padding: '2px 6px', borderRadius: '4px'}}>VERIFIED</span>}
               </div>
               <div style={styles.cardLocation}>{report.location}</div>
               {report.description && <p style={styles.cardDescription}>{report.description}</p>}
               {report.verificationReason && <p style={{...styles.cardDescription, fontStyle: 'italic', fontSize: '12px', color: 'var(--on-surface-variant-color)', marginTop: '8px', borderLeft: '2px solid var(--border-color)', paddingLeft: '8px'}}>{report.verificationReason}</p>}
           </div>
           <div style={styles.voteSection}>
               <button onClick={() => onVoteClick(report.id, 'up')} style={{...styles.voteButton, ...(userVote === 'up' && styles.voteButtonActive)}} aria-label="Upvote report">
                   <icons.thumbUp height="18px" width="18px" />
                   <span>{report.upvotes}</span>
               </button>
               <button onClick={() => onVoteClick(report.id, 'down')} style={{...styles.voteButton, ...(userVote === 'down' && styles.voteButtonActive)}} aria-label="Downvote report">
                   <icons.thumbDown height="18px" width="18px" />
                   <span>{report.downvotes}</span>
               </button>
           </div>
       </div>
    );
    
    const sortedUserReports = [...userReports].sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));

    const filteredResources = resources.filter(resource =>
        resource.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        resource.type.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    const renderContent = () => {
        if (isLoading) {
            return <div style={styles.centeredStatus}><div className="spinner"></div><p>Loading Alerts & Resources...</p></div>;
        }
        if (error) {
            return <div style={styles.centeredStatus}><p style={styles.errorText}>{error}</p></div>;
        }
        const hasAlerts = alerts.length > 0 || predictedAlerts.length > 0;
        
        return (
            <>
                {!hasAlerts && userReports.length === 0 &&(
                    <div style={styles.centeredStatus}>
                        <icons.checkShield style={{color: 'var(--google-green)', marginBottom: '16px'}}/>
                        <p>No active alerts in your area. Stay safe!</p>
                    </div>
                )}
                {alerts.length > 0 && (
                    <>
                        <div style={styles.subHeader}>Live Alerts</div>
                        {alerts.map(alert => <AlertCard key={alert.id} alert={alert} />)}
                    </>
                )}
                
                {predictedAlerts.length > 0 && (
                    <>
                        <div style={styles.subHeader}>Predicted Disasters</div>
                        {predictedAlerts.map(alert => <AlertCard key={alert.id} alert={alert} />)}
                    </>
                )}
                
                {userReports.length > 0 && (
                    <>
                        <div style={styles.subHeader}>Community Reports</div>
                        {sortedUserReports.map(report => 
                            <UserReportCard 
                                key={report.id} 
                                report={report} 
                                userVote={userVotes[report.id]}
                                onVoteClick={onVote}
                            />
                        )}
                    </>
                )}
                
                <div style={{borderTop: '1px solid var(--border-color)', margin: '16px 0'}} />
                
                <div style={styles.subHeader}>Resources</div>
                 <input
                    type="search"
                    placeholder="Search resources (e.g., hospital)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={styles.searchInput}
                />
                {filteredResources.length > 0
                    ? filteredResources.map(resource => <ResourceCard key={resource.id} resource={resource} />)
                    : <p style={styles.noResults}>No resources found.</p>
                }
            </>
        )
    }

    return (
        <div style={styles.panel}>
            <div style={styles.header}>Alerts & Resources</div>
            <div style={styles.list}>
                {renderContent()}
            </div>
            <div style={styles.footer}>
                <button style={styles.button} onClick={onGeneratePlanClick}>
                    Generate Emergency Plan
                </button>
            </div>
        </div>
    );
};

const MapComponent = ({ coords, alerts, predictedAlerts, resources, userReports, selectedAlert, evacuationRoute, onReportIncidentClick, newReportId }) => {
    const mapRef = useRef(null);
    const alertLayerRef = useRef(null);
    const resourceLayerRef = useRef(null);
    const userLocationLayerRef = useRef(null);
    const routeLayerRef = useRef(null);
    const userReportsLayerRef = useRef(null);

    useEffect(() => {
        if (!mapRef.current && coords) {
            const map = L.map('map').setView([coords.lat, coords.lng], 10);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(map);

            alertLayerRef.current = L.layerGroup().addTo(map);
            resourceLayerRef.current = L.layerGroup().addTo(map);
            routeLayerRef.current = L.layerGroup().addTo(map);
            userLocationLayerRef.current = L.layerGroup().addTo(map);
            userReportsLayerRef.current = L.layerGroup().addTo(map);
            
            mapRef.current = map;
        } else if (mapRef.current && coords) {
             mapRef.current.setView([coords.lat, coords.lng], 10);
        }
    }, [coords]);
    
    useEffect(() => {
        if (userLocationLayerRef.current && coords) {
            userLocationLayerRef.current.clearLayers();
            const iconHtml = `<div class="user-location-marker"></div>`;
            const customIcon = L.divIcon({ html: iconHtml, className: '' });
            L.marker([coords.lat, coords.lng], { icon: customIcon, zIndexOffset: 1000 }).addTo(userLocationLayerRef.current)
                .bindPopup(`<b>You are here</b>`);
        }
    }, [coords]);

    useEffect(() => {
        if (alertLayerRef.current) {
            alertLayerRef.current.clearLayers();
            const iconColors = {
                'High': 'var(--google-red)',
                'Critical': 'darkred',
                'Medium': 'var(--google-yellow)',
                'Low': 'var(--google-green)',
            };
            
            alerts.forEach(alert => {
                const iconHtml = `<div class="map-icon" style="width: 24px; height: 24px; background-color: ${iconColors[alert.severity] || 'grey'}; color: white;">!</div>`;
                const customIcon = L.divIcon({ html: iconHtml, className: '' });
                L.marker([alert.lat, alert.lng], { icon: customIcon }).addTo(alertLayerRef.current)
                    .bindPopup(`<b>${alert.type}</b><br>${alert.location}`);
            });

            predictedAlerts.forEach(alert => {
                const iconHtml = `<div class="map-icon" style="width: 28px; height: 28px; background-color: ${iconColors[alert.severity]}; font-size: 16px; border: 2px dashed #333;">🕒</div>`;
                const customIcon = L.divIcon({ html: iconHtml, className: '' });
                L.marker([alert.lat, alert.lng], { icon: customIcon }).addTo(alertLayerRef.current)
                    .bindPopup(`<b>${alert.type} (Predicted)</b><br>${alert.location}<br><i>${alert.timeframe}</i>`);
            });
        }
    }, [alerts, predictedAlerts]);
    
    useEffect(() => {
        if (resourceLayerRef.current) {
            resourceLayerRef.current.clearLayers();
            const resourceIcons = {'Shelter': '🏠', 'Hospital': '🏥', 'Food Bank': '🥫'};
             resources.forEach(resource => {
                const iconHtml = `<div class="map-icon" style="width: 24px; height: 24px; background-color: var(--google-blue); font-size: 16px;">${resourceIcons[resource.type] || 'ℹ️'}</div>`;
                const customIcon = L.divIcon({ html: iconHtml, className: '' });
                L.marker([resource.lat, resource.lng], { icon: customIcon }).addTo(resourceLayerRef.current)
                    .bindPopup(`<b>${resource.type}</b><br>${resource.name}`);
            });
        }
    }, [resources]);
    
     useEffect(() => {
        if (userReportsLayerRef.current) {
            userReportsLayerRef.current.clearLayers();
             userReports.forEach(report => {
                const isNew = report.id === newReportId;
                const iconHtml = `<div class="map-icon ${isNew ? 'new-report-marker' : ''}" style="width: 24px; height: 24px; background-color: var(--google-yellow); color: #333">👤</div>`;
                const customIcon = L.divIcon({ html: iconHtml, className: '' });
                const popupContent = `<b>${report.type} (Community Report)</b><br>${report.description || ''}${report.isVerified ? `<br><br><i style="color:var(--google-green)">Verified: ${report.verificationReason}</i>` : ''}`;
                L.marker([report.lat, report.lng], { icon: customIcon, zIndexOffset: 500 }).addTo(userReportsLayerRef.current)
                    .bindPopup(popupContent);
            });
        }
    }, [userReports, newReportId]);

    useEffect(() => {
        if (mapRef.current && routeLayerRef.current) {
            routeLayerRef.current.clearLayers();
            if (evacuationRoute && evacuationRoute.length > 0 && coords) {
                const latlngs = evacuationRoute.map(p => [p.lat, p.lng]);
                
                if (latlngs.length === 0 || latlngs[0][0] !== coords.lat || latlngs[0][1] !== coords.lng) {
                    latlngs.unshift([coords.lat, coords.lng]);
                }

                const polyline = L.polyline(latlngs, { 
                    color: 'var(--google-blue)', 
                    weight: 5,
                    opacity: 0.8,
                    dashArray: '10, 10' 
                }).addTo(routeLayerRef.current);
                
                mapRef.current.fitBounds(polyline.getBounds().pad(0.1));
            }
        }
    }, [evacuationRoute, coords]);

    useEffect(() => {
        if (mapRef.current && selectedAlert && !evacuationRoute) {
            mapRef.current.flyTo([selectedAlert.lat, selectedAlert.lng], 13);
        }
    }, [selectedAlert, evacuationRoute]);

    return (
        <div style={{ position: 'relative', flexGrow: 1 }}>
            <div id="map" style={{ width: '100%', height: '100%', zIndex: 1 }}></div>
            <button className="fab" onClick={onReportIncidentClick} aria-label="Report new incident">
                <icons.add />
            </button>
        </div>
    );
};

const PlanDisplay = ({ plan, checklistItems, onChecklistChange }) => {
    const [activeIndex, setActiveIndex] = useState(0);

    const styles = {
        item: {
            borderBottom: '1px solid var(--border-color)',
        },
        title: {
            padding: '16px',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            fontWeight: 500,
        },
        content: {
            padding: '0 16px 16px',
            maxHeight: 0,
            overflow: 'hidden',
            transition: 'max-height 0.3s ease-out, padding 0.3s ease-out',
            lineHeight: '1.6',
        },
        contentActive: {
            maxHeight: '1000px',
            padding: '0 16px 16px',
        },
        checklist: {
            listStyle: 'none',
            padding: 0,
            margin: 0,
        },
        checklistItem: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '10px',
            cursor: 'pointer',
        },
        checkbox: {
            width: '18px',
            height: '18px',
            cursor: 'pointer',
            accentColor: 'var(--google-blue)',
        }
    };

    return (
        <div>
            {plan.map((item, index) => (
                <div key={index} style={styles.item}>
                    <div style={styles.title} onClick={() => setActiveIndex(activeIndex === index ? null : index)}>
                        <span>{item.title}</span>
                        <span>{activeIndex === index ? '−' : '+'}</span>
                    </div>
                    <div style={{ ...styles.content, ...(activeIndex === index && styles.contentActive) }}>
                        {item.type === 'checklist' ? (
                            <ul style={styles.checklist}>
                                {item.items.map((checklistItem, i) => (
                                    <li key={i} style={styles.checklistItem} onClick={() => onChecklistChange(checklistItem)}>
                                        <input 
                                            type="checkbox" 
                                            id={`checklist-${index}-${i}`}
                                            checked={!!checklistItems[checklistItem]} 
                                            onChange={() => onChecklistChange(checklistItem)}
                                            style={styles.checkbox}
                                        />
                                        <label htmlFor={`checklist-${index}-${i}`}>{checklistItem}</label>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div dangerouslySetInnerHTML={{ __html: item.content }} />
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};


const PlanGeneratorModal = ({ isOpen, onClose, locationName }) => {
    const [viewMode, setViewMode] = useState('FORM');
    const [location, setLocation] = useState('');
    const [familySize, setFamilySize] = useState(1);
    const [rawPlan, setRawPlan] = useState('');
    const [parsedPlan, setParsedPlan] = useState([]);
    const [checklistItems, setChecklistItems] = useState({});
    const [error, setError] = useState('');
    const [isSaved, setIsSaved] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    const parsePlanText = (text) => {
        if (!text) return [];
        const sections = text.split(/(?=###\s)/).filter(s => s.trim() !== '');
        return sections.map(section => {
            const lines = section.trim().split('\n');
            const titleLine = lines.shift() || '';
            const title = titleLine.replace(/###\s(✅\s)?/, '').trim();
            
            if (titleLine.includes('### ✅')) {
                const items = lines
                    .map(line => line.replace(/-\s*\[\s*\]\s*/, '').trim())
                    .filter(item => item !== '');
                return { title, type: 'checklist', items };
            } else {
                const contentHtml = lines
                    .filter(line => line.trim() !== '')
                    .map(line => `<li>${line.replace(/-\s*/, '').trim()}</li>`)
                    .join('');
                return { title, type: 'content', content: `<ul>${contentHtml}</ul>` };
            }
        });
    };
    
    useEffect(() => {
        if (isOpen) {
            setLocation(locationName || 'My Current Location');
            const savedPlan = localStorage.getItem('emergencyPlan');
            const savedChecklist = localStorage.getItem('emergencyPlanChecklist');
            if (savedPlan) {
                setRawPlan(savedPlan);
                setParsedPlan(parsePlanText(savedPlan));
                if (savedChecklist) {
                    setChecklistItems(JSON.parse(savedChecklist));
                }
                setViewMode('SAVED');
            } else {
                setViewMode('FORM');
            }
        } else {
            setFamilySize(1);
            setRawPlan('');
            setParsedPlan([]);
            setChecklistItems({});
            setError('');
            setIsSaved(false);
            setIsGenerating(false);
        }
    }, [isOpen, locationName]);

    const handleGenerate = async () => {
        if (!location) {
            setError('Please enter a location.');
            return;
        }
        setIsGenerating(true);
        setViewMode('LOADING');
        setError('');
        setRawPlan('');
        setParsedPlan([]);
        setChecklistItems({});
        setIsSaved(false);

        const prompt = `Act as an expert civil defense officer. Your response must be professional, scannable, and use lists. Avoid conversational filler or introductory/concluding paragraphs.
Generate a precise emergency preparedness plan for a family of ${familySize} in "${location}". The plan must address region-specific threats based on that location.
Structure the output *only* in markdown format with the following required sections:

### 🚨 Immediate Actions for Most Likely Disaster
- (Provide 3-4 concise, critical first steps for the most probable disaster in the area)

### 📦 Emergency Kit (Region-Specific)
- (List essential items like water, ORS packets, first-aid, etc., tailored to the region)

### 📞 Communication Plan
- (Detail how family members can contact each other and list key emergency numbers for the area)

### 🏠 Home Safety Preparations
- (List actionable tips for securing a home against likely threats)

### ✅ Family Checklist
- Use this exact format for checklist items: "- [ ] Action or item to prepare".
- (Provide a list of 5-7 key preparation tasks for the family to complete).`;

        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
            });
            const planText = response.text;
            setRawPlan(planText);
            setParsedPlan(parsePlanText(planText));
            setViewMode('RESULT');
        } catch (e) {
            console.error(e);
            setError('Failed to generate a plan. Please check your connection or API key and try again.');
            setViewMode('FORM');
        } finally {
            setIsGenerating(false);
        }
    };
    
    const handleSavePlan = () => {
        localStorage.setItem('emergencyPlan', rawPlan);
        localStorage.setItem('emergencyPlanChecklist', JSON.stringify(checklistItems));
        setIsSaved(true);
    };
    
    const handleGenerateNew = () => {
        setViewMode('FORM');
        setRawPlan('');
        setParsedPlan([]);
        setChecklistItems({});
        setError('');
        setIsSaved(false);
    }
    
    const handleChecklistChange = (item) => {
        setChecklistItems(prev => ({
            ...prev,
            [item]: !prev[item]
        }));
    };

    if (!isOpen) return null;

    const styles = {
        overlay: {
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
        } as React.CSSProperties,
        modal: {
            backgroundColor: 'var(--surface-color)',
            padding: '24px',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '600px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-2)',
        } as React.CSSProperties,
        header: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
        },
        title: { fontSize: '20px', fontWeight: 500 },
        closeButton: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', color: 'var(--on-surface-variant-color)' },
        content: { overflowY: 'auto' } as React.CSSProperties,
        form: { display: 'flex', flexDirection: 'column', gap: '16px' } as React.CSSProperties,
        label: { fontWeight: 500, fontSize: '14px' },
        input: { padding: '10px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '16px' },
        button: { padding: '12px', border: 'none', borderRadius: '8px', backgroundColor: 'var(--google-blue)', color: 'white', fontSize: '16px', cursor: 'pointer', fontWeight: 500, opacity: isGenerating ? 0.7 : 1 },
        error: { color: 'var(--google-red)', marginTop: '10px' },
        footerButtons: { display: 'flex', gap: '10px', marginTop: '20px' },
        secondaryButton: { backgroundColor: 'var(--on-surface-variant-color)'}
    };

    const renderContent = () => {
        switch(viewMode) {
            case 'LOADING':
                return <div className="spinner"></div>;
            case 'FORM':
                return (
                     <div style={styles.form}>
                        <div>
                            <label htmlFor="location" style={styles.label}>Your Location</label>
                            <input id="location" type="text" value={location} onChange={e => setLocation(e.target.value)} style={styles.input} />
                        </div>
                        <div>
                            <label htmlFor="familySize" style={styles.label}>Number of People</label>
                            <input id="familySize" type="number" value={familySize} min="1" onChange={e => setFamilySize(parseInt(e.target.value, 10))} style={styles.input} />
                        </div>
                        <button onClick={handleGenerate} disabled={isGenerating} style={styles.button}>
                            {isGenerating ? 'Generating...' : 'Generate Plan'}
                        </button>
                        {error && <p style={styles.error}>{error}</p>}
                    </div>
                );
            case 'RESULT':
            case 'SAVED':
                return (
                    <div>
                        {viewMode === 'SAVED' && <p style={{fontWeight: 500, color: 'var(--google-green)', textAlign: 'center'}}>Displaying your saved plan.</p>}
                        <PlanDisplay plan={parsedPlan} checklistItems={checklistItems} onChecklistChange={handleChecklistChange} />
                        <div style={styles.footerButtons}>
                            {viewMode === 'RESULT' && (
                                <button onClick={handleSavePlan} style={styles.button} disabled={isSaved}>
                                    {isSaved ? 'Saved!' : 'Save Plan'}
                                </button>
                            )}
                             <button onClick={handleGenerateNew} style={{...styles.button, ...styles.secondaryButton, flexGrow: 1}}>
                                Generate New Plan
                            </button>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div style={styles.overlay} onClick={onClose}>
            <div style={styles.modal} onClick={e => e.stopPropagation()}>
                <div style={styles.header}>
                    <h2 style={styles.title}>AI Emergency Plan Generator</h2>
                    <button onClick={onClose} style={styles.closeButton} aria-label="Close modal"><icons.close /></button>
                </div>
                <div style={styles.content}>
                   {renderContent()}
                </div>
            </div>
        </div>
    );
};

const WeatherWidget = ({ weatherData, isLoading }) => {
    const styles = {
        widget: {
            position: 'absolute',
            top: '16px',
            right: '16px',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            borderRadius: '12px',
            padding: '12px 16px',
            boxShadow: 'var(--shadow-1)',
            zIndex: 400,
            width: '240px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
        } as React.CSSProperties,
        header: {
            fontSize: '16px',
            fontWeight: 500,
            color: 'var(--on-surface-color)',
            textAlign: 'center',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '8px',
            marginBottom: '4px',
        } as React.CSSProperties,
        content: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
        },
        icon: {
            fontSize: '36px',
        },
        details: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
        } as React.CSSProperties,
        temp: {
            fontSize: '22px',
            fontWeight: 500,
        },
        condition: {
            fontSize: '14px',
            color: 'var(--on-surface-variant-color)',
        },
        subDetails: {
             fontSize: '12px',
             color: 'var(--on-surface-variant-color)',
             marginTop: '4px',
             width: '100%',
             display: 'flex',
             justifyContent: 'space-between',
        },
        loadingText: {
            textAlign: 'center',
            color: 'var(--on-surface-variant-color)',
        } as React.CSSProperties,
    };

    if (isLoading) {
        return (
            <div style={styles.widget}>
                <div style={styles.header}>Weather</div>
                <p style={styles.loadingText}>Loading...</p>
            </div>
        );
    }

    if (!weatherData) return null;

    return (
        <div style={styles.widget}>
            <div style={styles.header}>{weatherData.name}</div>
            <div style={styles.content}>
                <span style={styles.icon}>{weatherData.icon}</span>
                <div style={styles.details}>
                    <div style={styles.temp}>{weatherData.temp}°C</div>
                    <div style={styles.condition}>{weatherData.condition}</div>
                </div>
            </div>
            <div style={styles.subDetails}>
                <span>Humidity: {weatherData.humidity}%</span>
                <span>Wind: {weatherData.windSpeed} km/h {weatherData.windDirection}</span>
            </div>
        </div>
    );
};

const ReportIncidentModal = ({ isOpen, onClose, onSubmit, isVerifying }) => {
    const [incidentType, setIncidentType] = useState('Flooding');
    const [description, setDescription] = useState('');
    
    const handleClose = () => {
        if (description && !window.confirm("Are you sure you want to close? Your report description will be lost.")) {
            return;
        }
        setIncidentType('Flooding');
        setDescription('');
        onClose();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const success = await onSubmit({ type: incidentType, description });
        if (success) {
            setIncidentType('Flooding');
            setDescription('');
            onClose();
        }
    };
    
    if (!isOpen) return null;
    
    const styles = {
        overlay: {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1100,
        } as React.CSSProperties,
        modal: {
            backgroundColor: 'var(--surface-color)', padding: '24px', borderRadius: '12px',
            width: '90%', maxWidth: '500px', maxHeight: '90vh', display: 'flex',
            flexDirection: 'column', boxShadow: 'var(--shadow-2)',
        } as React.CSSProperties,
        header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
        title: { fontSize: '20px', fontWeight: 500 },
        closeButton: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', color: 'var(--on-surface-variant-color)' },
        form: { display: 'flex', flexDirection: 'column', gap: '16px' } as React.CSSProperties,
        label: { fontWeight: 500, fontSize: '14px' },
        input: { padding: '10px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '16px', resize: 'vertical' as 'vertical' },
        button: { padding: '12px', border: 'none', borderRadius: '8px', backgroundColor: 'var(--google-blue)', color: 'white', fontSize: '16px', cursor: 'pointer', fontWeight: 500, opacity: isVerifying ? 0.7 : 1, },
    };

    return (
        <div style={styles.overlay} onClick={handleClose}>
            <div style={styles.modal} onClick={e => e.stopPropagation()}>
                <div style={styles.header}>
                    <h2 style={styles.title}>Report an Incident</h2>
                    <button onClick={handleClose} style={styles.closeButton} aria-label="Close modal"><icons.close /></button>
                </div>
                <form onSubmit={handleSubmit} style={styles.form}>
                    <div>
                        <label htmlFor="incidentType" style={styles.label}>Incident Type</label>
                        <select id="incidentType" value={incidentType} onChange={e => setIncidentType(e.target.value)} style={styles.input} disabled={isVerifying}>
                            <option>Flooding</option>
                            <option>Fallen Tree</option>
                            <option>Road Blockage</option>
                            <option>Power Outage</option>
                            <option>Other</option>
                        </select>
                    </div>
                     <div>
                        <label htmlFor="description" style={styles.label}>Description (optional)</label>
                        <textarea id="description" value={description} onChange={e => setDescription(e.target.value)} style={styles.input} rows={3} placeholder="e.g., Main street is blocked by a large banyan tree." disabled={isVerifying} />
                    </div>
                    <button type="submit" style={styles.button} disabled={isVerifying}>
                        {isVerifying ? 'Verifying...' : 'Submit Report'}
                    </button>
                </form>
            </div>
        </div>
    );
};

const App = () => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
    const [isAlertsPanelOpen, setIsAlertsPanelOpen] = useState(window.innerWidth > 768);
    const [selectedAlert, setSelectedAlert] = useState(null);
    const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    
    // Real-time data states
    const [coords, setCoords] = useState<{lat: number; lng: number} | null>(null);
    const [locationName, setLocationName] = useState('');
    const [liveAlerts, setLiveAlerts] = useState([]);
    const [predictedAlerts, setPredictedAlerts] = useState([]);
    const [resources, setResources] = useState([]);
    const [userReports, setUserReports] = useState(() => JSON.parse(localStorage.getItem('userReports')) || []);
    const [weatherData, setWeatherData] = useState(null);
    const [evacuationRoute, setEvacuationRoute] = useState(null);
    const [newReportId, setNewReportId] = useState(null);
    
    // Voting state
    const [userVotes, setUserVotes] = useState(() => JSON.parse(localStorage.getItem('userVotes')) || {});

    // Audible alerts states
    const [isAudibleAlertsEnabled, setIsAudibleAlertsEnabled] = useState(() => localStorage.getItem('audibleAlertsEnabled') === 'true');
    const announcedAlertIdsRef = useRef(new Set());
    const newReportTimeoutRef = useRef(null);

    // Loading, error, and offline states
    const [appState, setAppState] = useState('initializing'); // initializing, loading, ready, error
    const [appError, setAppError] = useState('');
    const [isRouteLoading, setIsRouteLoading] = useState(false);
    const [isVerifyingReport, setIsVerifyingReport] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    const activeView = isAlertsPanelOpen ? 'Alerts' : 'Dashboard';
    
    useEffect(() => {
        localStorage.setItem('audibleAlertsEnabled', String(isAudibleAlertsEnabled));
    }, [isAudibleAlertsEnabled]);
    
    useEffect(() => {
        localStorage.setItem('userVotes', JSON.stringify(userVotes));
    }, [userVotes]);
    
    useEffect(() => {
        localStorage.setItem('userReports', JSON.stringify(userReports));
    }, [userReports]);
    
    useEffect(() => {
        if (isAudibleAlertsEnabled && liveAlerts.length > 0) {
            const newCriticalAlerts = liveAlerts.filter(
                alert => alert.severity === 'Critical' && !announcedAlertIdsRef.current.has(alert.id)
            );

            if (newCriticalAlerts.length > 0) {
                newCriticalAlerts.forEach(alert => {
                    const utterance = new SpeechSynthesisUtterance(`Attention. Critical Alert: ${alert.type} near ${alert.location}.`);
                    speechSynthesis.speak(utterance);
                    announcedAlertIdsRef.current.add(alert.id);
                });
            }
        }
    }, [liveAlerts, isAudibleAlertsEnabled]);


    const loadAllData = async (lat, lng) => {
        setAppState('loading');
        setAppError('');
        try {
            const [alertsData, weather] = await Promise.all([
                fetchRealtimeAlerts(lat, lng),
                fetchAIWeatherData(lat, lng)
            ]);

            const currentAlerts = [...(alertsData.live_alerts || []), ...(alertsData.predicted_alerts || [])];
            const resourcesData = await fetchAIResources(lat, lng, currentAlerts);

            setLiveAlerts(alertsData.live_alerts || []);
            setPredictedAlerts(alertsData.predicted_alerts || []);
            setResources(resourcesData || []);
            setLocationName(alertsData.locationName || 'Current Location');
            setWeatherData(weather);
            setAppState('ready');

            // Cache data for offline use
            const cachePayload = {
                alertsData, weather, resourcesData, 
                coords: { lat, lng }, 
                locationName: alertsData.locationName,
                timestamp: new Date().getTime()
            };
            localStorage.setItem('sachet-cache', JSON.stringify(cachePayload));

        } catch (error) {
            console.error(error);
            setAppError("Could not fetch disaster data. Please try again.");
            setAppState('error');
        }
    };
    
    const loadFromCache = () => {
        const cachedData = localStorage.getItem('sachet-cache');
        if (cachedData) {
            setAppError("You are offline. Displaying last saved data.");
            const { alertsData, weather, resourcesData, coords: cachedCoords, locationName: cachedLocationName } = JSON.parse(cachedData);
            setLiveAlerts(alertsData.live_alerts || []);
            setPredictedAlerts(alertsData.predicted_alerts || []);
            setResources(resourcesData || []);
            setLocationName(cachedLocationName || 'Cached Location');
            setWeatherData(weather);
            setCoords(cachedCoords);
            setAppState('ready');
        } else {
            setAppState('error');
            setAppError("You are offline and no data is cached. Please connect to the internet.");
        }
    };


    const getLocation = () => {
        setAppState('initializing');
        setAppError("Fetching your location...");
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                setCoords({ lat: latitude, lng: longitude });
                loadAllData(latitude, longitude);
            },
            (error) => {
                console.error(`Geolocation error (${error.code}): ${error.message}`);
                let errorMessage = '';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = "Location access denied. Please enable it in your browser settings to get local alerts.";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = "Location information is unavailable. We can't detect your current position.";
                        break;
                    case error.TIMEOUT:
                        errorMessage = "The request to get your location timed out.";
                        break;
                    default:
                        errorMessage = "An unknown error occurred while trying to get your location.";
                        break;
                }
                setAppError(`${errorMessage} Showing data for default location (Chennai, India).`);
                const defaultCoords = { lat: 13.0827, lng: 80.2707 };
                setCoords(defaultCoords);
                loadAllData(defaultCoords.lat, defaultCoords.lng);
            },
            { timeout: 10000, enableHighAccuracy: true }
        );
    };

    useEffect(() => {
        // Service Worker Registration
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('Service Worker registered.'))
                    .catch(err => console.error('Service Worker registration failed:', err));
            });
        }

        // Online/Offline Listeners
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Initial data load strategy
        if (navigator.onLine) {
            getLocation();
        } else {
            loadFromCache();
        }

        const handleResize = () => {
            const isDesktop = window.innerWidth > 768;
            setIsSidebarOpen(isDesktop);
            setIsAlertsPanelOpen(isDesktop);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    const handleAlertClick = (item) => {
        setSelectedAlert(item);
        setEvacuationRoute(null);

        if (window.innerWidth <= 768) {
            setIsAlertsPanelOpen(false);
        }

        const isLiveAlert = item.severity && !item.timeframe && !['Hospital', 'Shelter', 'Food Bank', 'Community'].includes(item.type) && !item.description;

        if (isOnline && isLiveAlert && coords) {
            setIsRouteLoading(true);
            fetchAIEvacuationRoute(coords, item)
                .then(route => {
                    setEvacuationRoute(route);
                })
                .catch(err => {
                    console.error("Failed to get evacuation route:", err);
                })
                .finally(() => {
                    setIsRouteLoading(false);
                });
        }
    };
    
    const handleNavigate = (view) => {
        if (view === 'PlanGenerator') {
            setIsPlanModalOpen(true);
        } else if (view === 'Alerts') {
            setIsAlertsPanelOpen(!isAlertsPanelOpen);
        } else if (view === 'Dashboard') {
            setIsAlertsPanelOpen(false);
        }

        if (window.innerWidth <= 768) {
            setIsSidebarOpen(false);
        }
    };
    
    const handleRefresh = () => {
        if (!isOnline || appState === 'loading' || appState === 'initializing') return;
        announcedAlertIdsRef.current.clear();
        setLiveAlerts([]);
        setPredictedAlerts([]);
        setResources([]);
        setWeatherData(null);
        setEvacuationRoute(null);
        if (coords) {
            loadAllData(coords.lat, coords.lng);
        } else {
            getLocation();
        }
    };
    
    const handleAddReport = async (reportData) => {
        if (!coords) return false;
    
        setIsVerifyingReport(true);
        
        try {
            const verificationResult = await verifyAIIncidentReport(reportData, coords, liveAlerts);
            
            if (verificationResult.is_verified) {
                if (newReportTimeoutRef.current) {
                    clearTimeout(newReportTimeoutRef.current);
                }
    
                const newReport = {
                    ...reportData,
                    id: `user-${Date.now()}`,
                    lat: coords.lat,
                    lng: coords.lng,
                    location: `Near your current location`,
                    type: verificationResult.corrected_type,
                    isVerified: true,
                    verificationReason: verificationResult.reason,
                    upvotes: 0,
                    downvotes: 0,
                };
                setUserReports(prev => [...prev, newReport]);
                setNewReportId(newReport.id);
    
                newReportTimeoutRef.current = setTimeout(() => {
                    setNewReportId(null);
                    newReportTimeoutRef.current = null;
                }, 2000);
                
                return true;
            } else {
                alert(`Report Not Added: ${verificationResult.reason}`);
                return false;
            }
        } catch (error) {
            console.error("Error during report verification:", error);
            alert("An error occurred while verifying your report. Please try again.");
            return false;
        } finally {
            setIsVerifyingReport(false);
        }
    };
    
    const handleVote = (reportId, voteType) => {
        const currentUserVote = userVotes[reportId];
        let voteChanges = { up: 0, down: 0 };
        let newUserVoteState = { ...userVotes };

        if (currentUserVote === voteType) { // Retracting vote
            voteChanges[voteType] = -1;
            delete newUserVoteState[reportId];
        } else { // New vote or changing vote
            if (currentUserVote) { // Changing vote
                voteChanges[currentUserVote] = -1;
            }
            voteChanges[voteType] = 1;
            newUserVoteState[reportId] = voteType;
        }

        setUserReports(prevReports =>
            prevReports.map(report =>
                report.id === reportId
                    ? {
                        ...report,
                        upvotes: report.upvotes + voteChanges.up,
                        downvotes: report.downvotes + voteChanges.down,
                      }
                    : report
            )
        );
        setUserVotes(newUserVoteState);
    };


    const styles = {
        main: {
            display: 'flex',
            flexGrow: 1,
            height: 'calc(100vh - 64px)',
            position: 'relative',
        } as React.CSSProperties,
        mapContainer: {
            flexGrow: 1,
            position: 'relative',
        } as React.CSSProperties
    };

    return (
        <>
            <GlobalStyles />
            <Header 
                onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)} 
                onRefresh={handleRefresh}
                isRefreshing={appState === 'loading' || appState === 'initializing'}
                onToggleAudibleAlerts={() => setIsAudibleAlertsEnabled(prev => !prev)}
                isAudibleAlertsEnabled={isAudibleAlertsEnabled}
                isOnline={isOnline}
            />
            <main style={styles.main}>
                {(appState === 'initializing' || (appState === 'error' && !coords)) && (
                    <div className="loading-overlay">
                        {appState === 'initializing' && <div className="spinner"></div>}
                        <p>{appError}</p>
                    </div>
                )}
                <Sidebar isOpen={isSidebarOpen} activeView={activeView} onNavigate={handleNavigate} />
                <div style={styles.mapContainer}>
                     <MapComponent 
                        coords={coords}
                        alerts={liveAlerts} 
                        predictedAlerts={predictedAlerts}
                        resources={resources}
                        userReports={userReports}
                        selectedAlert={selectedAlert} 
                        evacuationRoute={evacuationRoute}
                        onReportIncidentClick={() => setIsReportModalOpen(true)}
                        newReportId={newReportId}
                     />
                     <WeatherWidget weatherData={weatherData} isLoading={!weatherData && (appState === 'loading' || appState === 'initializing')} />
                </div>
                {isAlertsPanelOpen && <AlertsPanel 
                    alerts={liveAlerts}
                    predictedAlerts={predictedAlerts}
                    resources={resources}
                    userReports={userReports}
                    isLoading={appState === 'loading' || appState === 'initializing'}
                    error={appState === 'error' ? appError : null}
                    onAlertClick={handleAlertClick}
                    onGeneratePlanClick={() => setIsPlanModalOpen(true)}
                    isRouteLoading={isRouteLoading}
                    selectedAlert={selectedAlert}
                    newReportId={newReportId}
                    onVote={handleVote}
                    userVotes={userVotes}
                />}
            </main>
            <PlanGeneratorModal isOpen={isPlanModalOpen} onClose={() => setIsPlanModalOpen(false)} locationName={locationName}/>
            <ReportIncidentModal isOpen={isReportModalOpen} onClose={() => setIsReportModalOpen(false)} onSubmit={handleAddReport} isVerifying={isVerifyingReport} />
        </>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);