// dataService.js
import supabaseClient from "./supabaseClient.js";

export async function fetchSightings() {
  const { data, error } = await supabaseClient
    .from("sightings")
    .select(`
      *,
      lighthouses (*)
    `)
    .order("id", { ascending: false });

  console.log(data, error);

  if (error) {
    console.error("Error fetching data:", error);
    return [];
  }

  return data;
}

