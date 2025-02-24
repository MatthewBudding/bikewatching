// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoibWF0dGhld2J1ZGRpbmciLCJhIjoiY203aWI2eTZjMGZiYzJrbzc4d3V6Mng3eSJ9.QAwtFP2u9zLDL8tvW688zA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18 // Maximum allowed zoom
});

let timeFilter = -1; // Initialize time filter
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

map.on('load', () => {
  // Add the data source
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
  });

  // Add the layer to visualize the data
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  // Load the Bluebikes station data
  const stationUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  const trafficUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

  Promise.all([d3.json(stationUrl), d3.csv(trafficUrl)]).then(([stationData, trafficData]) => {
    const stations = stationData.data.stations;
    const trips = trafficData;

    console.log('Loaded Station Data:', stationData);
    console.log('Loaded Traffic Data:', trafficData);

    // Convert date strings to Date objects and populate buckets
    trips.forEach(trip => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      const startedMinutes = minutesSinceMidnight(trip.started_at);
      const endedMinutes = minutesSinceMidnight(trip.ended_at);

      departuresByMinute[startedMinutes].push(trip);
      arrivalsByMinute[endedMinutes].push(trip);
    });

    // Calculate departures and arrivals
    const departures = d3.rollup(
      trips,
      v => v.length,
      d => d.start_station_id
    );

    const arrivals = d3.rollup(
      trips,
      v => v.length,
      d => d.end_station_id
    );

    // Add arrivals, departures, and totalTraffic properties to each station
    stations.forEach(station => {
      const id = station.short_name;
      station.arrivals = arrivals.get(id) ?? 0;
      station.departures = departures.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;
    });

    console.log('Updated Stations:', stations);

    // Select the SVG element inside the map container
    const svg = d3.select('#map').select('svg');

    // Define a helper function to convert coordinates
    function getCoords(station) {
      const lon = +station.lon;
      const lat = +station.lat;
      if (isNaN(lon) || isNaN(lat)) {
        console.error('Invalid coordinates:', station);
        return { cx: 0, cy: 0 }; // Return default coordinates for invalid data
      }
      const point = new mapboxgl.LngLat(lon, lat); // Convert lon/lat to Mapbox LngLat
      const { x, y } = map.project(point); // Project to pixel coordinates
      return { cx: x, cy: y }; // Return as object for use in SVG attributes
    }

    // Create a square root scale for circle radii
    const radiusScale = d3.scaleSqrt()
      .domain([0, d3.max(stations, d => d.totalTraffic)])
      .range([0, 25]);

    // Define a quantize scale for traffic flow
    const stationFlow = d3.scaleQuantize()
      .domain([0, 1])
      .range([0, 0.5, 1]);

    // Append circles to the SVG for each station
    const circles = svg.selectAll('circle')
      .data(stations)
      .enter()
      .append('circle')
      .attr('r', d => radiusScale(d.totalTraffic)) // Radius of the circle
      .attr('fill', 'steelblue') // Circle fill color
      .attr('stroke', 'white') // Circle border color
      .attr('stroke-width', 1) // Circle border thickness
      .attr('opacity', 0.6) // Circle opacity
      .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic)) // Set departure ratio
      .each(function(d) {
        // Add <title> for browser tooltips
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });

    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
      circles
        .attr('cx', d => getCoords(d).cx) // Set the x-position using projected coordinates
        .attr('cy', d => getCoords(d).cy); // Set the y-position using projected coordinates
    }

    // Initial position update when map loads
    updatePositions();

    // Reposition markers on map interactions
    map.on('move', updatePositions); // Update during map movement
    map.on('zoom', updatePositions); // Update during zooming
    map.on('resize', updatePositions); // Update on window resize
    map.on('moveend', updatePositions); // Final adjustment after movement ends

    // Slider elements
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    // Helper function to format time
    function formatTime(minutes) {
      const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
      return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
    }

    // Function to update the time display
    function updateTimeDisplay() {
      timeFilter = Number(timeSlider.value); // Get slider value

      if (timeFilter === -1) {
        selectedTime.textContent = ''; // Clear time display
        anyTimeLabel.style.display = 'block'; // Show "(any time)"
      } else {
        selectedTime.textContent = formatTime(timeFilter); // Display formatted time
        anyTimeLabel.style.display = 'none'; // Hide "(any time)"
      }

      // Trigger filtering logic
      filterTripsByTime();
    }

    // Helper function to filter trips by minute
    function filterByMinute(tripsByMinute, minute) {
      let minMinute = (minute - 60 + 1440) % 1440;
      let maxMinute = (minute + 60) % 1440;

      if (minMinute > maxMinute) {
        let beforeMidnight = tripsByMinute.slice(minMinute);
        let afterMidnight = tripsByMinute.slice(0, maxMinute);
        return beforeMidnight.concat(afterMidnight).flat();
      } else {
        return tripsByMinute.slice(minMinute, maxMinute).flat();
      }
    }

    // Function to filter trips by time
    function filterTripsByTime() {
      const filteredDepartures = timeFilter === -1
        ? trips
        : filterByMinute(departuresByMinute, timeFilter);

      const filteredArrivals = timeFilter === -1
        ? trips
        : filterByMinute(arrivalsByMinute, timeFilter);

      // Calculate filtered departures and arrivals
      const filteredDeparturesMap = d3.rollup(
        filteredDepartures,
        v => v.length,
        d => d.start_station_id
      );

      const filteredArrivalsMap = d3.rollup(
        filteredArrivals,
        v => v.length,
        d => d.end_station_id
      );

      // Update stations with filtered data
      const filteredStations = stations.map(station => {
        const id = station.short_name;
        station = { ...station }; // Clone the station object
        station.arrivals = filteredArrivalsMap.get(id) ?? 0;
        station.departures = filteredDeparturesMap.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
      });

      // Update the radius scale
      const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(filteredStations, d => d.totalTraffic)])
        .range(timeFilter === -1 ? [0, 25] : [3, 50]);

      // Update circles with filtered data
      circles.data(filteredStations)
        .attr('r', d => radiusScale(d.totalTraffic)) // Update radius
        .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic)) // Update departure ratio
        .each(function(d) {
          // Update <title> for browser tooltips
          d3.select(this).select('title')
            .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        });

      // Update circle positions
      updatePositions();
    }

    // Helper function to get minutes since midnight
    function minutesSinceMidnight(date) {
      return date.getHours() * 60 + date.getMinutes();
    }

    // Bind slider input event to updateTimeDisplay function
    timeSlider.addEventListener('input', updateTimeDisplay);

    // Set initial display state
    updateTimeDisplay();
  }).catch(error => {
    console.error('Error loading data:', error); // Handle errors if data loading fails
  });
});
