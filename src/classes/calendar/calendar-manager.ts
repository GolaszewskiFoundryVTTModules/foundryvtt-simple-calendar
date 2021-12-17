import Calendar from "./index";
import {CalendarConfiguration} from "../../interfaces";
import {GameSettings} from "../foundry-interfacing/game-settings";
import {PredefinedCalendars, SettingNames, SimpleCalendarHooks, SocketTypes, TimeKeeperStatus} from "../../constants";
import PredefinedCalendar from "../configuration/predefined-calendar";
import {Logger} from "../logging";
import {MainApplication} from "../index";
import Hook from "../api/hook";

/**
 * Class for managing multiple calendars
 */
export default class CalendarManager {
    /**
     * A list of all calendars
     * @type {Record<string, Calendar>>}
     */
    private calendars: Record<string, Calendar> = {};
    /**
     * The current calendar ID of the active calendar
     * @private
     */
    private activeId: string = '';

    /**
     * When loading in for the first time
     */
    public initialize(){
        const processed = this.loadCalendars();
        if(!processed){
            const cal = this.getDefaultCalendar();
            this.activeId = cal.id;
        }
    }

    /**
     * Will save all calendars to Foundry's settings DB
     */
    public saveCalendars(){
        const calendarConfigurations: CalendarConfiguration[] = [];
        for(const [key, value] of Object.entries(this.calendars)){
            calendarConfigurations.push(value.toConfig());
        }
        GameSettings.SaveObjectSetting(SettingNames.CalendarConfiguration, calendarConfigurations).catch(Logger.error);
    }

    /**
     * Loads calendars from Foundry's settings DB
     * @returns {number} The number of calendars loaded
     */
    public loadCalendars(): number {
        const calendars = <CalendarConfiguration[]>GameSettings.GetObjectSettings(SettingNames.CalendarConfiguration);
        //Default array is being returned with an empty string, if this is the case we need to return that empty string to get an empty array
        if(calendars.length === 1 && !calendars[0]){
            calendars.shift();
        }
        if(calendars.length){
            for(let i = 0; i < calendars.length; i++){
                if(calendars[i].id){
                    const existingCalendar = this.getCalendar(calendars[i].id);
                    if(existingCalendar){
                        existingCalendar.loadFromSettings(calendars[i]);
                    } else {
                        this.addCalendar(calendars[i].id, calendars[i].name || `Calendar ${i}`, calendars[i]);
                    }
                    if(i === 0 && this.activeId === ''){
                        this.activeId = calendars[i].id;
                    }
                }
            }
        }
        MainApplication.updateApp();
        return calendars.length;
    }

    /**
     * Adds a new calendar
     * @param {string} id The ID to assign to this calendar, if an empty string is passed in an ID will be generated
     * @param {string} name The name of this calendar
     * @param {CalendarConfiguration} configuration The configuration object for the new calendar
     * @returns {Calendar} The newly create Calendar object
     */
    public addCalendar(id: string, name: string, configuration: CalendarConfiguration): Calendar{
        const cal = new Calendar(id, name, configuration);
        this.calendars[cal.id] = cal;
        return this.calendars[cal.id];
    }

    /**
     * Adds a new temporary calendar to the calendar list
     * @param name
     */
    public addTempCalendar(name: string){
        const cal = new Calendar('', name);
        cal.id += '_temp';
        this.calendars[cal.id] = cal;
        return this.calendars[cal.id];
    }

    /**
     * Gets the default calendar, if the default does not exist create it
     * @returns {Calendar} The default calendar
     */
    public getDefaultCalendar(): Calendar{
        let dCal = this.getCalendar('default');
        if(!dCal){
            dCal = this.addCalendar('default', 'Default', {id: ''});
            //Set the default calendar type to be our Gregorian calendar
            PredefinedCalendar.setToPredefined(dCal.year, PredefinedCalendars.Gregorian);
        }
        return dCal;
    }

    /**
     * Gets the calendar with the passed in ID
     * @param {string} id The ID of the calendar to get
     * @returns {Calendar | null} The found calendar, or if an invalid ID was passed in null
     */
    public getCalendar(id: string): Calendar | null {
        if(this.calendars.hasOwnProperty(id)){
            return this.calendars[id];
        } else {
            return null;
        }
    }

    /**
     * Gets an array of all calendars
     * @returns {Calendar[]}
     */
    public getAllCalendars(clones: boolean = false): Calendar[] {
        const cals: Calendar[] = [];
        for(const [key, value] of Object.entries(this.calendars)){
            if((!clones && !key.endsWith('_temp')) || (clones && key.endsWith('_temp'))){
                cals.push(value);
            }
        }
        return cals;
    }

    /**
     * Gets the currently active calendar
     * @returns {Calendar}
     */
    public getActiveCalendar(): Calendar{
        return this.calendars[this.activeId];
    }

    /**
     * Makes the internal calendar list match the passed in list of calendars. Will remove any missing calendars, update existing and add new.
     * @param {Calendar[]} calendars The new list of calendars
     */
    public setCalendars(calendars: Calendar[]){
        if(calendars.length){
            //Remove calendars that are no longer in the list
            for(const [key, value] of Object.entries(this.calendars)){
                let found = calendars.findIndex(c => c.id === key) > -1;
                if(!found){
                    delete this.calendars[key];
                }
            }
            //Go through each calendar in the list and if the calendar exists, update its settings. Otherwise add the new calendar
            for(let i = 0; i < calendars.length; i++){
                if(this.calendars[calendars[i].id]){
                    this.calendars[calendars[i].id].loadFromSettings(calendars[i].toConfig());
                } else {
                    this.calendars[calendars[i].id] = calendars[i];
                }
            }
            //If the active calendar is no longer around then we need to reset it to the first calendar
            if(!this.getActiveCalendar()){
                this.setActiveCalendar(calendars[0].id);
            }
        }
    }

    /**
     * Sets the active calendar to the calendar with the passed in ID
     * @param {string} id The ID of the new active calendar
     */
    public setActiveCalendar(id: string){
        const newActive = this.getCalendar(id);
        if(newActive){
            for(const [key, value] of Object.entries(this.calendars)){
                value.timeKeeper.pause();
            }
            this.activeId = newActive.id;
            if(newActive.timeKeeper.getStatus() === TimeKeeperStatus.Paused){
                newActive.timeKeeper.start(true);
            }
            (<Game>game).socket?.emit(SocketTypes.clock);
            MainApplication.clockClass = newActive.timeKeeper.getStatus();
            MainApplication.updateApp();

            //TODO: Add check if we want to force the timestamps to change with the changing of the calendar
            //Simple Time: Updates on the world time changing
            //Weather Control: Updates on the date time change hook
            newActive.syncTime(true).catch(Logger.error);
            Hook.emit(SimpleCalendarHooks.DateTimeChange, newActive);
        }
    }

    /**
     * Removes the calendar with the passed in ID from the list of calendars
     * @param id
     */
    public removeCalendar(id: string){
        if(this.calendars.hasOwnProperty(id)){
            this.calendars[id].timeKeeper.stop();
            delete this.calendars[id];
        }
    }

    /**
     * Creates temporary copies of each calendar. This allows the calendars to be accessed by other tools (like the Renderer)
     */
    public cloneCalendars(){
        const cals: Calendar[] = [];
        for(const [key, value] of Object.entries(this.calendars)){
            if(value.id.endsWith('_temp')){
                cals.push(value)
            } else {
                const clone = value.clone();
                clone.id += '_temp';
                this.calendars[clone.id] = clone;
                cals.push(clone);
            }
        }
        return cals;
    }

    /**
     * Merges the temporary copies of the calendars into the calendar they were cloned from.
     */
    public mergeClonedCalendars(){
        const cloneIds: {key: string, value: Calendar}[] = [];
        //Get a list of Calendar ID's that we are keeping
        for(const [key, value] of Object.entries(this.calendars)){
            if(key.endsWith('_temp')){
                value.id = value.id.replace('_temp', '');
                cloneIds.push({key: key.replace('_temp', ''), value: value});
            }
        }
        for(let i = 0; i < cloneIds.length; i++){
            const exCal = this.getCalendar(cloneIds[i].key);
            //Update existing calendars with the new details
            if(exCal){
                exCal.loadFromSettings(cloneIds[i].value.toConfig());
            }
            //Add new calendars
            else {
                this.calendars[cloneIds[i].key] = cloneIds[i].value;
            }
        }
        //Remove Calendars
        for(const [key, value] of Object.entries(this.calendars)){
            let found = cloneIds.findIndex(c => c.value.id === key) > -1;
            if(!found){
                delete this.calendars[key];
            }
        }
        //If the active calendar is no longer around then we need to reset it to the first calendar
        if(!this.getActiveCalendar()){
            this.setActiveCalendar(cloneIds[0].key);
        }
    }

    /**
     * Removes all clone instances from the list of calendars
     */
    public clearClones(){
        for(const [key, value] of Object.entries(this.calendars)){
            if(value.id.endsWith('_temp')){
                delete this.calendars[key];
            }
        }
    }
}