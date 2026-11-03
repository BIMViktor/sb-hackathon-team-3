/** Fake project used when the widget is opened outside StreamBIM. */

export const project = {
  id: "hackathon-sandbox",
  name: "Hackathon Sandbox",
  userEmail: "team@hackathon.local",
};

export const floors = [
  { id: "floor-1", name: "Plan 1", elevation: 0 },
  { id: "floor-2", name: "Plan 2", elevation: 3.2 },
  { id: "floor-3", name: "Plan 3", elevation: 6.4 },
];

export const objects = [
  {
    guid: "MOCK-DOOR-101",
    name: "Dörr 101",
    type: "IfcDoor",
    floorId: "floor-1",
    point: [4.2, 1.1, 0.9],
    props: { Type: "IfcDoor", Name: "Dörr 101", IsExternal: "True" },
  },
  {
    guid: "MOCK-WALL-A",
    name: "Vägg A",
    type: "IfcWall",
    floorId: "floor-1",
    point: [2, 1.4, 0],
    props: { Type: "IfcWall", Name: "Vägg A", IsExternal: "True" },
  },
  {
    guid: "MOCK-WINDOW-12",
    name: "Fönster 12",
    type: "IfcWindow",
    floorId: "floor-2",
    point: [6.5, 4.6, 1.2],
    props: { Type: "IfcWindow", Name: "Fönster 12", IsExternal: "True" },
  },
  {
    guid: "MOCK-SPACE-201",
    name: "Rum 201",
    type: "IfcSpace",
    floorId: "floor-2",
    point: [8, 4.8, 1.5],
    props: { Type: "IfcSpace", Name: "Rum 201", LongName: "Mötesrum" },
  },
];
